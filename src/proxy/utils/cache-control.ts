import type { TriState } from '../../config-schema.js';
import { ANTHROPIC_NATIVE_ENDPOINTS, classifyEndpoint } from '../paths.js';
import { isAnthropicModel } from './model.js';

export function isAnthropicEndpoint(
  modelName: string | undefined,
  path: string,
): boolean {
  const endpoint = classifyEndpoint(path);
  return ANTHROPIC_NATIVE_ENDPOINTS.has(endpoint) || isAnthropicModel(modelName ?? '');
}

export function shouldInjectCacheControl(
  mode: TriState,
  modelName: string | undefined,
  path: string,
): boolean {
  if (mode === 'skip') return false;
  if (mode === 'always') return true;
  return isAnthropicEndpoint(modelName, path);
}

export function buildCacheControl(
  existing: unknown,
  ttl: '5m' | '1h' | 'omit' | 'skip' | undefined,
  isAnthropic: boolean,
): Record<string, unknown> {
  const base =
    existing !== null && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};

  // Anthropic rejects cache_control without `type`.
  if (!('type' in base)) base.type = 'ephemeral';

  if (ttl === 'omit') {
    delete base.ttl; // strip ttl (incl. client value)
  } else if (ttl === '5m' || ttl === '1h') {
    if (isAnthropic) base.ttl = ttl; // Anthropic only
  }
  // skip/undefined → passthrough
  return base;
}

/**
 * Whether to normalize block-level cache_control TTLs. Mirrors the cacheControl
 * tri-state: `auto` rewrites only when injection is active on an Anthropic-native
 * endpoint; `always` rewrites everywhere; `skip` never.
 */
export function shouldRewriteBlockTtl(
  mode: TriState,
  cacheControlMode: TriState,
  modelName: string | undefined,
  path: string,
): boolean {
  if (mode === 'skip') return false;
  if (mode === 'always') return true;
  return (
    isAnthropicEndpoint(modelName, path) &&
    shouldInjectCacheControl(cacheControlMode, modelName, path)
  );
}

/** Shallow, order-independent comparison of two cache_control objects. */
function sameCacheControl(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => a[k] === b[k]);
}

/**
 * Normalize the TTL on every existing block-level cache_control breakpoint
 * (system, tools, messages[].content) to match the configured TTL. Reuses
 * buildCacheControl so block and root stay consistent. Adds no new breakpoints.
 * Returns whether any block was changed.
 */
export function rewriteBlockTtls(
  body: Record<string, unknown>,
  ttl: '5m' | '1h' | 'omit' | 'skip' | undefined,
  isAnthropic: boolean,
): boolean {
  let mutated = false;

  // Rewrite the cache_control on a single block object (if it has one).
  const rewriteNode = (obj: Record<string, unknown>): void => {
    const cc = obj.cache_control;
    if (cc !== null && typeof cc === 'object' && !Array.isArray(cc)) {
      const next = buildCacheControl(cc, ttl, isAnthropic);
      if (!sameCacheControl(cc as Record<string, unknown>, next)) {
        obj.cache_control = next;
        mutated = true;
      }
    }
  };

  // Visit an array of blocks: rewrite each, and descend only into a block's
  // `content` (covers nested tool_result content blocks). Do NOT recurse into
  // arbitrary nested values (e.g. a tool's input_schema).
  const visitBlocks = (arr: unknown): void => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
      const obj = item as Record<string, unknown>;
      rewriteNode(obj);
      visitBlocks(obj.content);
    }
  };

  visitBlocks(body.system);
  visitBlocks(body.tools);
  const messages = body.messages as Record<string, unknown>[] | undefined;
  for (const m of messages ?? []) {
    if (m === null || typeof m !== 'object' || Array.isArray(m)) continue;
    // Message-level cache_control (openrouter/openai convention) lives directly
    // on the message object, not inside its content blocks — rewrite it before
    // descending, else a client's ttl-less breakpoint (5m) survives alongside
    // rewritten 1h breakpoints and Anthropic rejects "1h after 5m".
    rewriteNode(m);
    visitBlocks(m.content);
    // OpenAI-format tool_calls are a sibling of content; a cache_control here is a
    // breakpoint too. Left unrewritten it stays 5m ahead of the next tool result's
    // 1h breakpoint → same "1h after 5m" rejection.
    visitBlocks(m.tool_calls);
  }

  return mutated;
}
