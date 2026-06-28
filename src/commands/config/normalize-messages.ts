import * as clack from '@clack/prompts';
import { DEFAULTS, readConfigFileRaw } from '../../config.js';
import { requireConfigPath, setGlobalConfigFields } from './config.js';
import { askNormalizeMessages } from './prompts.js';

export async function normalizeMessagesCommand(opts?: {
  configPath?: string;
}): Promise<void> {
  const configPath = requireConfigPath(opts?.configPath);
  const cfg = readConfigFileRaw(configPath);
  const raw = cfg.normalizeMessages;
  const effective = raw ?? DEFAULTS.normalizeMessages;

  clack.log.info(
    `Current: normalizeMessages = ${raw === undefined ? `(default -> ${effective ? 'on' : 'off'})` : effective}`,
  );

  const choice = await askNormalizeMessages(
    'Lift stray role:"system" out of /v1/messages into top-level system? Fixes 400 rejections from strict Anthropic-format providers (OpenRouter → GLM et al.). Acts on /v1/messages only.',
    raw,
    {
      removable: true,
      resetHint: `remove (default: ${DEFAULTS.normalizeMessages ? 'on' : 'off'})`,
    },
  );
  if (typeof choice === 'symbol') return; // cancelled

  const fields: Record<string, unknown> = {};
  fields.normalizeMessages = choice === 'reset' ? undefined : choice;
  setGlobalConfigFields(configPath, fields);

  const label = choice === 'reset' ? `(default: ${DEFAULTS.normalizeMessages})` : choice;
  clack.log.success(`normalizeMessages set to ${label}`);
}
