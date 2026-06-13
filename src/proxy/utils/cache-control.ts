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

export function buildCacheControl(
  existing: unknown,
  ttl: '5m' | '1h' | undefined,
  isAnthropic: boolean,
): Record<string, unknown> {
  const base =
    existing !== null && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};

  // Anthropic API requires `type`; default to 'ephemeral'.
  if (!('type' in base)) base.type = 'ephemeral';

  if (ttl && isAnthropic) base.ttl = ttl;
  return base;
}
