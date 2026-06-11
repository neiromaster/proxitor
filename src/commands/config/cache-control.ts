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

  const fields: Record<string, unknown> = {
    cacheControl: cc === DEFAULTS.cacheControl ? undefined : cc,
  };

  if (cc !== 'never') {
    const ttlResult = await askCacheControlTtl(currentTtl as '5m' | '1h' | undefined);
    if (ttlResult === 'reset') {
      fields.cacheControlTtl = undefined; // remove TTL from config
    } else if (ttlResult !== null) {
      fields.cacheControlTtl = ttlResult;
    }
    // ttlResult === null → cancel: don't include cacheControlTtl, preserve existing
  }
  // cc === 'never' → don't touch cacheControlTtl at all
  // The application logic ignores TTL when cacheControl is 'never'

  setGlobalConfigFields(configPath, fields);

  const ttlPart = fields.cacheControlTtl ? `, TTL = ${fields.cacheControlTtl}` : '';
  clack.log.success(`cacheControl set to ${cc}${ttlPart}`);
}
