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

export const TTL_SECONDS: Readonly<Record<'5m' | '1h', number>> = {
  '5m': 300,
  '1h': 3600,
};

/**
 * Build cache_control value for injection.
 * Merges existing cache_control with configured TTL.
 * If TTL is configured and endpoint is Anthropic, it always overrides.
 */
export function buildCacheControl(
  existing: unknown,
  ttl: '5m' | '1h' | undefined,
  modelName: string | undefined,
  path: string,
): Record<string, unknown> {
  const result: Record<string, unknown> =
    existing && typeof existing === 'object'
      ? { ...(existing as Record<string, unknown>) }
      : { type: 'ephemeral' };

  if (ttl && isAnthropicEndpoint(modelName, path)) {
    result.ttl = TTL_SECONDS[ttl];
  }

  return result;
}
