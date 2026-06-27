import * as clack from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import { readConfigFileRaw } from '../../config.js';
import type { ModelOverride } from '../../config-schema.js';
import { requireConfigPath, setModelOverride } from './config.js';
import { overridesEqual } from './equality.js';
import { normalizeMessagesCommand } from './normalize-messages.js';
import { normalizeResponsesCommand } from './normalize-responses.js';
import { editNormalizeMessages, editNormalizeResponses } from './override-levers.js';

type LeverValue = 'normalizeResponses' | 'normalizeMessages';

/** Compatibility fixes for request bodies OpenRouter rejects. Mirrors caching-menu's lever table. */
const FIXES_LEVERS: ReadonlyArray<{
  value: LeverValue;
  label: string;
  global: (configPath: string) => Promise<void>;
  perModel: (current: ModelOverride) => Promise<ModelOverride>;
}> = [
  {
    value: 'normalizeResponses',
    label: 'Repair /v1/responses bodies (normalizeResponses)',
    global: configPath => normalizeResponsesCommand({ configPath }),
    perModel: current => editNormalizeResponses(current),
  },
  {
    value: 'normalizeMessages',
    label: 'Lift role:system out of /v1/messages (normalizeMessages)',
    global: configPath => normalizeMessagesCommand({ configPath }),
    perModel: current => editNormalizeMessages(current),
  },
];

async function runFixesLeverMenu(opts: {
  noteTitle: string;
  backLabel: string;
  renderNote: () => string;
  onLever: (lever: (typeof FIXES_LEVERS)[number]) => Promise<void>;
}): Promise<void> {
  for (;;) {
    clack.note(opts.renderNote(), opts.noteTitle);

    const choice = await clack.select<string>({
      message: 'Tune which fix?',
      options: [
        ...FIXES_LEVERS.map(lever => ({ value: lever.value, label: lever.label })),
        { value: 'back', label: opts.backLabel },
      ],
    });
    if (isCancel(choice) || choice === 'back') return;

    const chosen = FIXES_LEVERS.find(l => l.value === choice);
    if (chosen) await opts.onLever(chosen);
  }
}

export async function globalFixesMenu(opts?: { configPath?: string }): Promise<void> {
  const configPath = requireConfigPath(opts?.configPath);

  await runFixesLeverMenu({
    noteTitle: 'Fixes',
    backLabel: '← Back',
    renderNote: () => {
      const raw = readConfigFileRaw(configPath);
      return [
        `normalizeResponses: ${raw.normalizeResponses ?? '(default → auto)'}`,
        `normalizeMessages: ${raw.normalizeMessages ?? '(default → auto)'}`,
      ].join('\n');
    },
    onLever: lever => lever.global(configPath),
  });
}

/** Self-persists each lever; returns the latest override. */
export async function perModelFixesMenu(opts: {
  modelKey: string;
  current: ModelOverride;
  configPath: string;
}): Promise<ModelOverride> {
  let current = opts.current;

  await runFixesLeverMenu({
    noteTitle: `Fixes for "${opts.modelKey}"`,
    backLabel: '← Back to override edit',
    renderNote: () =>
      [
        `normalizeResponses: ${current.normalizeResponses ?? '(inherit)'}`,
        `normalizeMessages: ${current.normalizeMessages ?? '(inherit)'}`,
      ].join('\n'),
    onLever: async lever => {
      const next = await lever.perModel(current);
      // Skip no-op writes.
      if (!overridesEqual(next, current)) {
        setModelOverride(opts.configPath, opts.modelKey, next);
        current = next;
      }
    },
  });

  return current;
}

export async function fixesCommand(opts?: { configPath?: string }): Promise<void> {
  clack.intro('Proxitor · Fixes');
  await globalFixesMenu(opts);
  clack.outro('Bye!');
}
