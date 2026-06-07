import { classifyEndpoint, type Endpoint } from '../paths.js';
import { isAnthropicModel } from './model.js';

const ANTHROPIC_NATIVE_ENDPOINTS: ReadonlySet<Endpoint> = new Set([
  'messages',
  'responses',
]);

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

export function buildCacheControlValue(
  ttl: '5m' | '1h' | undefined,
  modelName: string | undefined,
  path: string,
): { type: 'ephemeral'; ttl?: number } {
  if (ttl && isAnthropicEndpoint(modelName, path)) {
    return { type: 'ephemeral', ttl: TTL_SECONDS[ttl] };
  }
  return { type: 'ephemeral' };
}
