import * as clack from '@clack/prompts';
import { DEFAULTS, readConfigFileRaw } from '../../config.js';
import { requireConfigPath, setGlobalConfigField } from './config.js';
import { askTriState, NORMALIZE_RESPONSES_HINTS } from './prompts.js';

export async function normalizeResponsesCommand(opts?: {
  configPath?: string;
}): Promise<void> {
  const configPath = requireConfigPath(opts?.configPath);
  const cfg = readConfigFileRaw(configPath);
  const raw = cfg.normalizeResponses;
  const effective = raw ?? DEFAULTS.normalizeResponses;

  clack.log.info(
    `Current: normalizeResponses = ${raw === undefined ? `(default -> ${effective})` : effective}`,
  );

  const result = await askTriState(
    'normalizeResponses mode',
    raw,
    NORMALIZE_RESPONSES_HINTS,
    {
      removable: true,
    },
  );

  if (typeof result === 'symbol') return;

  if (result === 'reset') {
    setGlobalConfigField(configPath, 'normalizeResponses', undefined);
    clack.log.success('normalizeResponses reset to default (auto)');
    return;
  }
  setGlobalConfigField(configPath, 'normalizeResponses', result);
  clack.log.success(`normalizeResponses set to ${result}`);
}
