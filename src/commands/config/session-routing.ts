import * as clack from '@clack/prompts';
import { DEFAULTS, readConfigFile } from '../../config.js';
import type { TriState } from '../../config-schema.js';
import { requireConfigPath, setGlobalConfigField } from './config.js';
import { askTriState, SESSION_HINTS } from './prompts.js';

export async function sessionRoutingCommand(opts?: {
  configPath?: string;
}): Promise<void> {
  const configPath = requireConfigPath(opts?.configPath);
  const cfg = readConfigFile(configPath);
  const current = cfg.sessionId ?? DEFAULTS.sessionId;

  clack.log.info(`Current: sessionId = ${current}`);

  const result = await askTriState(
    'Session routing mode',
    current as TriState,
    SESSION_HINTS,
  );

  if (result === null) return;

  setGlobalConfigField(configPath, 'sessionId', result);
  clack.log.success(`sessionId set to ${result}`);
}
