import * as clack from '@clack/prompts';
import { DEFAULTS, readConfigFile } from '../../config.js';
import { requireConfigPath, setGlobalConfigFields } from './config.js';
import {
  askCacheControlTtl,
  askTriState,
  CACHE_HINTS,
  type TriState,
} from './prompts.js';

export async function cacheControlCommand(opts?: { configPath?: string }): Promise<void> {
  const configPath = requireConfigPath(opts?.configPath);
  const cfg = readConfigFile(configPath);
  const currentCc = cfg.cacheControl ?? DEFAULTS.cacheControl;
  const currentTtl = cfg.cacheControlTtl;

  clack.log.info(`Current: cacheControl = ${currentCc}`);
  if (currentTtl) clack.log.info(`Current: cacheControlTtl = ${currentTtl}`);

  const cc = await askTriState('Cache control mode', currentCc as TriState, CACHE_HINTS);
  if (cc === null) return;

  let ttl: '5m' | '1h' | null | undefined = currentTtl;
  if (cc !== 'never') {
    const ttlResult = await askCacheControlTtl(currentTtl as '5m' | '1h' | undefined);
    if (ttlResult === null) {
      ttl = undefined;
    } else if (ttlResult === 'reset') {
      ttl = null;
    } else {
      ttl = ttlResult;
    }
  } else {
    ttl = null;
  }

  setGlobalConfigFields(configPath, {
    cacheControl: cc === DEFAULTS.cacheControl ? undefined : cc,
    cacheControlTtl: ttl === null || ttl === undefined ? undefined : ttl,
  });

  clack.log.success(`cacheControl set to ${cc}${ttl ? `, TTL = ${ttl}` : ''}`);
}
