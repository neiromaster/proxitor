import type { Usage } from '@proxitor/plugin-api';
import type { Json } from '../shared/validate.js';

export function toUsage(value: unknown): Usage | undefined {
  if (value === undefined || value === null || typeof value !== 'object')
    return undefined;
  const usage = value as Json;
  return {
    inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
    outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
    ...(typeof usage.cache_read_input_tokens === 'number'
      ? { cacheReadTokens: usage.cache_read_input_tokens }
      : {}),
    ...(typeof usage.cache_creation_input_tokens === 'number'
      ? { cacheCreateTokens: usage.cache_creation_input_tokens }
      : {}),
  };
}
