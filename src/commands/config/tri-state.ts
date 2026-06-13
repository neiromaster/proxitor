import type { TriState } from '../../config-schema.js';
import {
  askCacheControlTtl,
  askTriState,
  CACHE_HINTS,
  SESSION_HINTS,
} from './prompts.js';

export async function collectSessionTriState(
  currentSid?: TriState,
): Promise<{ sessionId: TriState } | null> {
  const sid = await askTriState(
    'Session ID mode',
    (currentSid ?? 'auto') as TriState,
    SESSION_HINTS,
  );
  if (sid === null) return null;
  return { sessionId: sid };
}

/**
 * TTL cancel behaviour: pressing Escape on the TTL prompt preserves the
 * existing TTL rather than silently dropping it.
 */
export async function collectCacheTriState(
  currentCc?: TriState,
  currentTtl?: '5m' | '1h' | null,
): Promise<{ cacheControl: TriState; cacheControlTtl?: '5m' | '1h' } | null> {
  const cc = await askTriState(
    'Cache control mode',
    (currentCc ?? 'auto') as TriState,
    CACHE_HINTS,
  );
  if (cc === null) return null;

  const result: { cacheControl: TriState; cacheControlTtl?: '5m' | '1h' } = {
    cacheControl: cc,
  };

  if (cc !== 'never') {
    const ttl = await askCacheControlTtl((currentTtl as '5m' | '1h') ?? undefined);
    if (ttl === null) {
      // Cancel — preserve existing TTL
      if (currentTtl) result.cacheControlTtl = currentTtl;
    } else if (ttl !== 'reset') {
      result.cacheControlTtl = ttl;
    }
  }

  return result;
}
