import * as clack from '@clack/prompts';
import { DEFAULTS, readConfigFile } from '../../config.js';
import type { TriState } from '../../config-schema.js';
import { requireConfigPath, setGlobalConfigFields } from './config.js';
import { askCacheControlTtl, askTriState, CACHE_HINTS } from './prompts.js';

export async function cacheControlCommand(opts?: { configPath?: string }): Promise<void> {
  const configPath = requireConfigPath(opts?.configPath);
  const cfg = readConfigFile(configPath);
  const currentCc = cfg.cacheControl ?? DEFAULTS.cacheControl;
  const currentTtl = cfg.cacheControlTtl;

  clack.log.info(`Current: cacheControl = ${currentCc}`);
  if (currentTtl) clack.log.info(`Current: cacheControlTtl = ${currentTtl}`);

  const cc = await askTriState('Cache control mode', currentCc as TriState, CACHE_HINTS, {
    removable: true,
  });
  if (typeof cc === 'symbol') return;

  const fields: Record<string, unknown> = {};
  fields.cacheControl = cc === 'reset' ? undefined : cc;

  // TTL decoupled from mode — always asked.
  const ttlResult = await askCacheControlTtl(
    currentTtl as '5m' | '1h' | 'omit' | 'never' | undefined,
    { removable: true },
  );
  if (typeof ttlResult === 'symbol') {
    // TTL cancelled — still apply the cacheControl change only.
    setGlobalConfigFields(configPath, fields);
    clack.log.success(`cacheControl set to ${cc === 'reset' ? '(default)' : cc}`);
    return;
  }
  fields.cacheControlTtl = ttlResult === 'reset' ? undefined : ttlResult;

  setGlobalConfigFields(configPath, fields);

  const ccLabel = cc === 'reset' ? '(default)' : cc;
  const ttlLabel = ttlResult === 'reset' ? '(default)' : ttlResult;
  clack.log.success(`cacheControl set to ${ccLabel}, TTL = ${ttlLabel}`);
}
