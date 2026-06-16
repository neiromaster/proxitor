import * as clack from '@clack/prompts';
import { DEFAULTS, readConfigFile } from '../../config.js';
import { requireConfigPath, setGlobalConfigFields } from './config.js';

export async function normalizeVolatileSystemCommand(opts?: {
  configPath?: string;
}): Promise<void> {
  const configPath = requireConfigPath(opts?.configPath);
  const cfg = readConfigFile(configPath);
  const current = cfg.normalizeVolatileSystem ?? DEFAULTS.normalizeVolatileSystem;

  clack.log.info(`Current: normalizeVolatileSystem = ${current}`);

  const choice = await clack.select<boolean | 'reset'>({
    message:
      "Normalize Claude Code's volatile cch hash in the system prompt? Stabilizes the prefix cache for non-Anthropic providers (qwen/glm/etc.).",
    options: [
      { value: true, label: 'On', hint: 'rewrite cch → stable prefix' },
      { value: false, label: 'Off', hint: 'passthrough' },
      {
        value: 'reset',
        label: 'Reset',
        hint: `remove (default: ${DEFAULTS.normalizeVolatileSystem})`,
      },
    ],
    initialValue: current,
  });
  if (typeof choice === 'symbol') return; // cancelled

  const fields: Record<string, unknown> = {};
  fields.normalizeVolatileSystem = choice === 'reset' ? undefined : choice;
  setGlobalConfigFields(configPath, fields);

  const label =
    choice === 'reset' ? `(default: ${DEFAULTS.normalizeVolatileSystem})` : choice;
  clack.log.success(`normalizeVolatileSystem set to ${label}`);
}
