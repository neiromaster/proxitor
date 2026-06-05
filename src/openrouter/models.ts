import { readCache, writeCache } from './cache.js';
import type { OpenRouterDataClient } from './data-client.js';
import type { OpenRouterModel } from './types.js';

const CACHE_KEY = 'models';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function fetchModels(
  client: OpenRouterDataClient,
): Promise<OpenRouterModel[]> {
  const cached = readCache<OpenRouterModel[]>(CACHE_KEY, CACHE_TTL);
  if (cached) return cached;

  const models = await client.fetchModels();
  writeCache(CACHE_KEY, models);
  return models;
}

/** `"anthropic/claude-sonnet-4"` → `"anthropic"` */
export function parseModelAuthor(modelId: string): string {
  return modelId.split('/')[0] ?? '';
}

/** `"anthropic/claude-sonnet-4"` → `"claude-sonnet-4"` */
export function parseModelSlug(modelId: string): string {
  return modelId.split('/').slice(1).join('/');
}

/** `"0.000003"` → `"$3.00"`, `"0"` → `"free"` */
export function formatPrice(pricePerToken: string): string {
  const per1M = Number.parseFloat(pricePerToken) * 1_000_000;
  if (per1M === 0) return 'free';
  if (per1M < 0.01) return `$${per1M.toFixed(4)}`;
  return `$${per1M.toFixed(2)}`;
}
