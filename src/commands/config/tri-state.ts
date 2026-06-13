import type { TriState } from '../../config-schema.js';
import {
  askCacheControlTtl,
  askTriState,
  CACHE_HINTS,
  SESSION_HINTS,
} from './prompts.js';

/** A per-field resolution: explicitly set, explicitly removed, or (when omitted) kept as-is. */
export type ResolvedField<T> = { remove: true } | { value: T };

/**
 * Apply a resolved field to a plain object in place.
 * - `{ value }` → assign
 * - `{ remove: true }` → delete the key
 * - `undefined` → leave the existing value untouched (cancel / keep)
 */
export function applyField<T>(
  obj: Record<string, unknown>,
  key: string,
  field: ResolvedField<T> | undefined,
): void {
  if (field === undefined) return;
  if ('remove' in field) delete obj[key];
  else obj[key] = field.value;
}

export async function collectSessionTriState(
  currentSid?: TriState,
): Promise<{ sessionId: ResolvedField<TriState> } | null> {
  const sid = await askTriState(
    'Session ID mode',
    (currentSid ?? 'auto') as TriState,
    SESSION_HINTS,
    { removable: true },
  );
  if (typeof sid === 'symbol') return null; // cancelled → caller keeps everything
  if (sid === 'reset') return { sessionId: { remove: true } };
  return { sessionId: { value: sid } };
}

/**
 * TTL is decoupled from cache mode: it is always asked and can exist on its own
 * (it refines the inherited mode). Cancelling the TTL prompt preserves the
 * existing TTL (field omitted from the patch); cancelling the mode prompt
 * cancels the whole edit (returns null).
 */
export async function collectCacheTriState(
  currentCc?: TriState,
  currentTtl?: '5m' | '1h' | 'omit' | 'never',
  globalTtl?: '5m' | '1h' | 'omit' | 'never',
): Promise<{
  cacheControl: ResolvedField<TriState>;
  cacheControlTtl?: ResolvedField<'5m' | '1h' | 'omit' | 'never'>;
} | null> {
  const cc = await askTriState(
    'Cache control mode',
    (currentCc ?? 'auto') as TriState,
    CACHE_HINTS,
    { removable: true },
  );
  if (typeof cc === 'symbol') return null;

  let cacheControl: ResolvedField<TriState>;
  if (cc === 'reset') {
    cacheControl = { remove: true };
  } else {
    cacheControl = { value: cc };
  }

  const ttl = await askCacheControlTtl(currentTtl, { removable: true, globalTtl });
  if (typeof ttl === 'symbol') {
    // cancel → keep existing TTL (omit cacheControlTtl from the patch)
    return { cacheControl };
  }
  if (ttl === 'reset') {
    return { cacheControl, cacheControlTtl: { remove: true } };
  }
  return { cacheControl, cacheControlTtl: { value: ttl } };
}
