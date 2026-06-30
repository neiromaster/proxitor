import * as clack from '@clack/prompts';
import { fixBaseline, readConfigFileRaw } from '../../config.js';
import { requireConfigPath, setGlobalConfigField } from './config.js';
import { askTriState, SESSION_HINTS } from './prompts.js';

export async function sessionRoutingCommand(opts?: {
  configPath?: string;
}): Promise<void> {
  const configPath = requireConfigPath(opts?.configPath);
  const cfg = readConfigFileRaw(configPath);
  const raw = cfg.sessionId;
  const base = fixBaseline(cfg.recommended);
  const effective = raw ?? base.sessionId;

  clack.log.info(
    `Current: sessionId = ${raw === undefined ? `(default -> ${effective})` : effective}`,
  );

  const result = await askTriState('Session routing mode', raw, SESSION_HINTS, {
    removable: true,
  });

  if (typeof result === 'symbol') return;

  if (result === 'reset') {
    setGlobalConfigField(configPath, 'sessionId', undefined);
    clack.log.success(`sessionId reset to default (${base.sessionId})`);
    return;
  }
  setGlobalConfigField(configPath, 'sessionId', result);
  clack.log.success(`sessionId set to ${result}`);
}
