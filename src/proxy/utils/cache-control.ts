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
