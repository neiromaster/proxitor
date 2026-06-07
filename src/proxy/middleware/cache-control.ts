import { isAnthropicModel } from '../inject.js';
import { classifyEndpoint } from '../paths.js';

export function shouldInjectCacheControl(
  mode: 'auto' | 'always' | 'never',
  modelName: string | undefined,
  path: string,
): boolean {
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  if (classifyEndpoint(path) === 'chat-completions' && !isAnthropicModel(modelName ?? ''))
    return false;
  return true;
}
