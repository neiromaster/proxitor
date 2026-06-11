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
  mode: 'auto' | 'always' | 'never',
  modelName: string | undefined,
  path: string,
): boolean {
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  return isAnthropicEndpoint(modelName, path);
}

/**
 * Build cache_control value for injection.
 * Merges existing cache_control with configured TTL.
 * If TTL is configured and the endpoint is Anthropic, it always overrides.
 */
export function buildCacheControl(
  existing: unknown,
  ttl: '5m' | '1h' | undefined,
  isAnthropic: boolean,
): Record<string, unknown> {
  // Reject arrays, null, and other non-plain-object shapes — a malformed
  // existing cache_control (e.g. an array) should not leak into the request
  // as numeric keys or missing `type`. Treat it the same as "no existing."
  const isPlainObject =
    existing !== null && typeof existing === 'object' && !Array.isArray(existing);
  const result: Record<string, unknown> = isPlainObject
    ? { ...(existing as Record<string, unknown>) }
    : { type: 'ephemeral' };

  // The Anthropic cache_control contract requires a `type`. If the client
  // sent an object without one (e.g. { ttl: 600 }), default to 'ephemeral'
  // so upstream doesn't reject the payload.
  if (!('type' in result)) {
    result.type = 'ephemeral';
  }

  if (ttl && isAnthropic) {
    result.ttl = ttl;
  }

  return result;
}
