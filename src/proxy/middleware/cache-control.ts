import { isAnthropicModel } from '../inject.js';

export function shouldInjectCacheControl(
  mode: 'auto' | 'always' | 'never',
  modelName: string | undefined,
  path: string,
): boolean {
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  // auto mode: only skip for non-Anthropic models on /v1/chat/completions
  // (other injectable paths are always safe per OpenRouter API)
  if (path === '/v1/chat/completions' && !isAnthropicModel(modelName ?? '')) return false;
  return true;
}
