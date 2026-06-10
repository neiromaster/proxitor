import * as clack from '@clack/prompts';
import { DEFAULTS, readConfigFile } from '../../config.js';
import { requireConfigPath, setGlobalConfigField } from './config.js';
import { askTriState, type TriState } from './prompts.js';

export async function sessionRoutingCommand(opts?: {
  configPath?: string;
}): Promise<void> {
  const configPath = requireConfigPath(opts?.configPath);
  const cfg = readConfigFile(configPath);
  const current = cfg.sessionId ?? DEFAULTS.sessionId;

  clack.log.info(`Current: sessionId = ${current}`);

  const result = await askTriState('Session routing mode', current as TriState, {
    auto: 'Passthrough client ID, generate if missing',
    always: 'Always generate proxy session ID',
    never: "Don't manage session headers",
  });

  if (result === null) return;

  const value = result === DEFAULTS.sessionId ? undefined : result;
  setGlobalConfigField(configPath, 'sessionId', value);
  clack.log.success(`sessionId set to ${result}`);
}
