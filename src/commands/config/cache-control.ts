import * as clack from '@clack/prompts';
import { fixBaseline, readConfigFileRaw } from '../../config.js';
import type { TriState } from '../../config-schema.js';
import { requireConfigPath, setGlobalConfigFields } from './config.js';
import { collectCacheTriState, type ResolvedField } from './tri-state.js';

/**
 * Map a ResolvedField into the `fields` object for `setGlobalConfigFields`:
 * {value}→assign value, {remove}→assign undefined (delete from disk),
 * undefined→omit the key (keep existing on disk).
 *
 * This is the file-write counterpart of `applyField`. The in-memory `applyField`
 * can `delete` an existing key, but a fresh `fields` object fed to
 * `setGlobalConfigFields` needs an explicit `undefined` value to trigger
 * removal — so keep-existing (undefined field) must be distinguished from
 * remove ({remove:true}) by omitting vs. assigning the key.
 */
function assignField<T>(
  fields: Record<string, unknown>,
  key: string,
  field: ResolvedField<T> | undefined,
): void {
  if (field === undefined) return; // keep existing on disk
  fields[key] = 'remove' in field ? undefined : field.value;
}

function fieldLabel(field: ResolvedField<unknown> | undefined, fallback: string): string {
  if (field === undefined) return fallback;
  if ('remove' in field) return '(default)';
  return String(field.value);
}

export async function cacheControlCommand(opts?: { configPath?: string }): Promise<void> {
  const configPath = requireConfigPath(opts?.configPath);
  const cfg = readConfigFileRaw(configPath);
  const rawCc = cfg.cacheControl as TriState | undefined;
  const rawTtl = cfg.cacheControlTtl as '5m' | '1h' | 'omit' | 'skip' | undefined;
  const rawRewrite = cfg.rewriteBlockTtl as TriState | undefined;
  const base = fixBaseline(cfg.recommended ?? false);
  const effectiveCc = rawCc ?? (base.cacheControl as TriState);
  const effectiveRewrite = rawRewrite ?? (base.rewriteBlockTtl as TriState);

  clack.log.info(
    `Current: cacheControl = ${rawCc === undefined ? `(default -> ${effectiveCc})` : effectiveCc}`,
  );
  if (rawTtl) clack.log.info(`Current: cacheControlTtl = ${rawTtl}`);
  clack.log.info(
    `Current: rewriteBlockTtl = ${rawRewrite === undefined ? `(default -> ${effectiveRewrite})` : rawRewrite}`,
  );

  const result = await collectCacheTriState(rawCc, rawTtl, undefined, rawRewrite);
  if (result === null) return; // mode cancelled

  const fields: Record<string, unknown> = {};
  assignField(fields, 'cacheControl', result.cacheControl);
  assignField(fields, 'cacheControlTtl', result.cacheControlTtl);
  assignField(fields, 'rewriteBlockTtl', result.rewriteBlockTtl);
  setGlobalConfigFields(configPath, fields);

  clack.log.success(
    `cacheControl set to ${fieldLabel(result.cacheControl, effectiveCc)}, TTL = ${fieldLabel(result.cacheControlTtl, '(unchanged)')}, rewrite = ${fieldLabel(result.rewriteBlockTtl, effectiveRewrite)}`,
  );
}
