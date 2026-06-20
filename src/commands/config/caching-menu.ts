import * as clack from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import { readConfigFile, readConfigFileRaw } from '../../config.js';
import type { ModelOverride } from '../../config-schema.js';
import { cacheControlCommand } from './cache-control.js';
import {
  formatGlobalCachingSummary,
  formatPerModelCachingSummary,
} from './caching-summary.js';
import { requireConfigPath, setModelOverride } from './config.js';
import { overridesEqual } from './equality.js';
import { normalizeVolatileSystemCommand } from './normalize-system.js';
import {
  editCacheControl,
  editNormalizeVolatileSystem,
  editSessionId,
} from './override-levers.js';
import { sessionRoutingCommand } from './session-routing.js';

type LeverValue = 'cacheControl' | 'sessionId' | 'normalizeVolatileSystem';

/** Cache levers: option list + dispatch in one table. */
const CACHING_LEVERS: ReadonlyArray<{
  value: LeverValue;
  label: string;
  global: (configPath: string) => Promise<void>;
  perModel: (current: ModelOverride, configPath: string) => Promise<ModelOverride>;
}> = [
  {
    value: 'cacheControl',
    label: 'Activate caching — mode + TTL (cacheControl)',
    global: configPath => cacheControlCommand({ configPath }),
    perModel: (current, configPath) => editCacheControl(current, configPath),
  },
  {
    value: 'sessionId',
    label: 'Pin provider (sessionId)',
    global: configPath => sessionRoutingCommand({ configPath }),
    perModel: current => editSessionId(current),
  },
  {
    value: 'normalizeVolatileSystem',
    label: 'Stabilize prefix (normalizeVolatileSystem)',
    global: configPath => normalizeVolatileSystemCommand({ configPath }),
    perModel: current => editNormalizeVolatileSystem(current),
  },
];

async function runCachingLeverMenu(opts: {
  noteTitle: string;
  backLabel: string;
  renderNote: () => string;
  onLever: (lever: (typeof CACHING_LEVERS)[number]) => Promise<void>;
}): Promise<void> {
  for (;;) {
    clack.note(opts.renderNote(), opts.noteTitle);

    const choice = await clack.select<string>({
      message: 'Tune which lever?',
      options: [
        ...CACHING_LEVERS.map(lever => ({ value: lever.value, label: lever.label })),
        { value: 'back', label: opts.backLabel },
      ],
    });
    if (isCancel(choice) || choice === 'back') return;

    const chosen = CACHING_LEVERS.find(l => l.value === choice);
    if (chosen) await opts.onLever(chosen);
  }
}

export async function globalCachingMenu(opts?: { configPath?: string }): Promise<void> {
  const configPath = requireConfigPath(opts?.configPath);

  await runCachingLeverMenu({
    noteTitle: 'Prompt caching',
    backLabel: '← Back',
    renderNote: () => formatGlobalCachingSummary(readConfigFileRaw(configPath)),
    onLever: lever => lever.global(configPath),
  });
}

/** Self-persists each lever; returns the latest override. */
export async function perModelCachingMenu(opts: {
  modelKey: string;
  current: ModelOverride;
  configPath: string;
}): Promise<ModelOverride> {
  let current = opts.current;

  await runCachingLeverMenu({
    noteTitle: `Caching for "${opts.modelKey}"`,
    backLabel: '← Back to override edit',
    renderNote: () =>
      formatPerModelCachingSummary(
        opts.modelKey,
        current,
        readConfigFile(opts.configPath),
      ),
    onLever: async lever => {
      const next = await lever.perModel(current, opts.configPath);
      // Skip no-op writes; instant-save still fires on real changes.
      if (!overridesEqual(next, current)) {
        setModelOverride(opts.configPath, opts.modelKey, next);
        current = next;
      }
    },
  });

  return current;
}

export async function cachingCommand(opts?: { configPath?: string }): Promise<void> {
  clack.intro('Proxitor · Caching');
  await globalCachingMenu(opts);
  clack.outro('Bye!');
}
