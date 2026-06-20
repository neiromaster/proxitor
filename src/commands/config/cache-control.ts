import * as clack from '@clack/prompts';
import { DEFAULTS, readConfigFileRaw } from '../../config.js';
import { requireConfigPath, setGlobalConfigFields } from './config.js';
import { askCacheControlTtl, askTriState, CACHE_HINTS } from './prompts.js';

export async function cacheControlCommand(opts?: { configPath?: string }): Promise<void> {
  const configPath = requireConfigPath(opts?.configPath);
  const cfg = readConfigFileRaw(configPath);
  const rawCc = cfg.cacheControl;
  const rawTtl = cfg.cacheControlTtl;
  const effectiveCc = rawCc ?? DEFAULTS.cacheControl;

  clack.log.info(
    `Current: cacheControl = ${rawCc === undefined ? `(default -> ${effectiveCc})` : effectiveCc}`,
  );
  if (rawTtl) clack.log.info(`Current: cacheControlTtl = ${rawTtl}`);

  const cc = await askTriState('Cache control mode', rawCc, CACHE_HINTS, {
    removable: true,
  });
  if (typeof cc === 'symbol') return;

  const fields: Record<string, unknown> = {};
  fields.cacheControl = cc === 'reset' ? undefined : cc;

  const ttlResult = await askCacheControlTtl(rawTtl, {
    removable: true,
  });
  if (typeof ttlResult === 'symbol') {
    // TTL cancelled — apply cacheControl only.
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
