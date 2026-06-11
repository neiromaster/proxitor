/**
 * Shared helpers for tri-state field editing (session ID, cache control).
 * Centralises the TTL-on-cancel logic and the inherit-by-omission pattern
 * used by both the add and edit flows.
 */

import type { TriState } from './prompts.js';
import {
  askCacheControlTtl,
  askTriState,
  CACHE_HINTS,
  SESSION_HINTS,
} from './prompts.js';

// ---------------------------------------------------------------------------
// Session ID
// ---------------------------------------------------------------------------

/**
 * Prompt the user for a session routing mode.
 * Returns the updated override (with `sessionId` set) or `null` on cancel.
 */
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

// ---------------------------------------------------------------------------
// Cache Control
// ---------------------------------------------------------------------------

/**
 * Prompt the user for a cache control mode and optional TTL.
 * Returns the updated fields or `null` on tri-state cancel.
 *
 * **TTL cancel behaviour**: when the user presses Escape on the TTL prompt
 * the existing TTL is preserved (not silently dropped).
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
