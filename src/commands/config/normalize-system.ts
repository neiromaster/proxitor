import * as clack from '@clack/prompts';
import { DEFAULTS, readConfigFileRaw } from '../../config.js';
import { requireConfigPath, setGlobalConfigFields } from './config.js';
import { askNormalizeVolatileSystem } from './prompts.js';

export async function normalizeVolatileSystemCommand(opts?: {
  configPath?: string;
}): Promise<void> {
  const configPath = requireConfigPath(opts?.configPath);
  const cfg = readConfigFileRaw(configPath);
  const raw = cfg.normalizeVolatileSystem;
  const effective = raw ?? DEFAULTS.normalizeVolatileSystem;

  clack.log.info(
    `Current: normalizeVolatileSystem = ${raw === undefined ? `(default -> ${effective ? 'on' : 'off'})` : effective}`,
  );

  const choice = await askNormalizeVolatileSystem(
    "Normalize Claude Code's volatile cch hash in the system prompt? Stabilizes the prefix cache for non-Anthropic providers (qwen/glm/etc.).",
    raw,
    {
      removable: true,
      resetHint: `remove (default: ${DEFAULTS.normalizeVolatileSystem})`,
    },
  );
  if (typeof choice === 'symbol') return; // cancelled

  const fields: Record<string, unknown> = {};
  fields.normalizeVolatileSystem = choice === 'reset' ? undefined : choice;
  setGlobalConfigFields(configPath, fields);

  const label =
    choice === 'reset' ? `(default: ${DEFAULTS.normalizeVolatileSystem})` : choice;
  clack.log.success(`normalizeVolatileSystem set to ${label}`);
}
