import type { TriState } from '../../config-schema.js';
import {
  askCacheControlTtl,
  askTriState,
  CACHE_HINTS,
  SESSION_HINTS,
} from './prompts.js';

/** Set, removed, or (omitted) keep existing. */
export type ResolvedField<T> = { remove: true } | { value: T };

/** Apply a resolved field: {value}→assign, {remove}→delete, undefined→keep. */
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
  if (typeof sid === 'symbol') return null; // cancelled
  if (sid === 'reset') return { sessionId: { remove: true } };
  return { sessionId: { value: sid } };
}

/** TTL is independent of cache mode. Mode-cancel aborts; TTL-cancel keeps existing TTL. */
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
    // cancel → keep existing TTL
    return { cacheControl };
  }
  if (ttl === 'reset') {
    return { cacheControl, cacheControlTtl: { remove: true } };
  }
  return { cacheControl, cacheControlTtl: { value: ttl } };
}
