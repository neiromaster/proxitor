import * as clack from '@clack/prompts';
import { DEFAULTS, readConfigFileRaw } from '../../config.js';
import { requireConfigPath, setGlobalConfigField } from './config.js';
import { askTriState, NORMALIZE_MESSAGES_HINTS } from './prompts.js';

export async function normalizeMessagesCommand(opts?: {
  configPath?: string;
}): Promise<void> {
  const configPath = requireConfigPath(opts?.configPath);
  const cfg = readConfigFileRaw(configPath);
  const raw = cfg.normalizeMessages;
  const effective = raw ?? DEFAULTS.normalizeMessages;

  clack.log.info(
    `Current: normalizeMessages = ${raw === undefined ? `(default -> ${effective})` : effective}`,
  );

  const result = await askTriState(
    'normalizeMessages mode',
    raw,
    NORMALIZE_MESSAGES_HINTS,
    {
      removable: true,
    },
  );

  if (typeof result === 'symbol') return;

  if (result === 'reset') {
    setGlobalConfigField(configPath, 'normalizeMessages', undefined);
    clack.log.success('normalizeMessages reset to default (auto)');
    return;
  }
  setGlobalConfigField(configPath, 'normalizeMessages', result);
  clack.log.success(`normalizeMessages set to ${result}`);
}
