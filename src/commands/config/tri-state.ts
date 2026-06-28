import type { TriState } from '../../config-schema.js';
import {
  askCacheControlTtl,
  askNormalizeMessages,
  askNormalizeVolatileSystem,
  askTriState,
  CACHE_HINTS,
  NORMALIZE_RESPONSES_HINTS,
  REWRITE_HINTS,
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
  const sid = await askTriState('Session ID mode', currentSid, SESSION_HINTS, {
    removable: true,
  });
  if (typeof sid === 'symbol') return null; // cancelled
  if (sid === 'reset') return { sessionId: { remove: true } };
  return { sessionId: { value: sid } };
}

export async function collectNormalizeResponsesTriState(
  currentNr?: TriState,
): Promise<{ normalizeResponses: ResolvedField<TriState> } | null> {
  const nr = await askTriState(
    'normalizeResponses mode',
    currentNr,
    NORMALIZE_RESPONSES_HINTS,
    {
      removable: true,
    },
  );
  if (typeof nr === 'symbol') return null; // cancelled
  if (nr === 'reset') return { normalizeResponses: { remove: true } };
  return { normalizeResponses: { value: nr } };
}

export async function collectNormalizeMessages(
  currentNm?: boolean,
): Promise<{ normalizeMessages: ResolvedField<boolean> } | null> {
  const nm = await askNormalizeMessages(
    'Lift role:system out of /v1/messages',
    currentNm,
    { removable: true },
  );
  if (typeof nm === 'symbol') return null; // cancelled
  if (nm === 'reset') return { normalizeMessages: { remove: true } };
  return { normalizeMessages: { value: nm } };
}

/**
 * Collects cacheControl mode, TTL, and rewriteBlockTtl.
 * Mode-cancel aborts; TTL-cancel keeps existing TTL; rewrite-cancel keeps existing rewrite.
 */
export async function collectCacheTriState(
  currentCc?: TriState,
  currentTtl?: '5m' | '1h' | 'omit' | 'skip',
  globalTtl?: '5m' | '1h' | 'omit' | 'skip',
  currentRewrite?: TriState,
): Promise<{
  cacheControl: ResolvedField<TriState>;
  cacheControlTtl?: ResolvedField<'5m' | '1h' | 'omit' | 'skip'>;
  rewriteBlockTtl?: ResolvedField<TriState>;
} | null> {
  const cc = await askTriState('Cache control mode', currentCc, CACHE_HINTS, {
    removable: true,
  });
  if (typeof cc === 'symbol') return null;

  let cacheControl: ResolvedField<TriState>;
  if (cc === 'reset') {
    cacheControl = { remove: true };
  } else {
    cacheControl = { value: cc };
  }

  const ttl = await askCacheControlTtl(currentTtl, { removable: true, globalTtl });
  let cacheControlTtl: ResolvedField<'5m' | '1h' | 'omit' | 'skip'> | undefined;
  if (typeof ttl === 'symbol') {
    cacheControlTtl = undefined; // cancel → keep existing TTL
  } else if (ttl === 'reset') {
    cacheControlTtl = { remove: true };
  } else {
    cacheControlTtl = { value: ttl };
  }

  const rewrite = await askTriState('Rewrite block TTLs', currentRewrite, REWRITE_HINTS, {
    removable: true,
  });
  let rewriteBlockTtl: ResolvedField<TriState> | undefined;
  if (typeof rewrite === 'symbol') {
    rewriteBlockTtl = undefined; // cancel → keep existing
  } else if (rewrite === 'reset') {
    rewriteBlockTtl = { remove: true };
  } else {
    rewriteBlockTtl = { value: rewrite };
  }

  return { cacheControl, cacheControlTtl, rewriteBlockTtl };
}

export async function collectNormalizeVolatileSystem(
  currentNvs?: boolean,
): Promise<{ normalizeVolatileSystem: ResolvedField<boolean> } | null> {
  const nvs = await askNormalizeVolatileSystem(
    'Normalize volatile system (cch/cc_version hashes)',
    currentNvs,
    { removable: true },
  );
  if (typeof nvs === 'symbol') return null; // cancelled
  if (nvs === 'reset') return { normalizeVolatileSystem: { remove: true } };
  return { normalizeVolatileSystem: { value: nvs } };
}
