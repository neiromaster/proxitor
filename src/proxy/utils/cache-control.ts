import { classifyEndpoint, type Endpoint } from '../paths.js';
import { isAnthropicModel } from './model.js';

const ANTHROPIC_NATIVE_ENDPOINTS: ReadonlySet<Endpoint> = new Set([
  'messages',
  'responses',
]);

export function shouldInjectCacheControl(
  mode: 'auto' | 'always' | 'never',
  modelName: string | undefined,
  path: string,
): boolean {
  if (mode === 'never') return false;
  if (mode === 'always') return true;

  const endpoint = classifyEndpoint(path);
  const safeForCache =
    ANTHROPIC_NATIVE_ENDPOINTS.has(endpoint) || isAnthropicModel(modelName ?? '');
  return safeForCache;
}
