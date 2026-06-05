import { readCache, writeCache } from './cache.js';
import type { OpenRouterDataClient } from './data-client.js';
import type { OpenRouterProvider } from './types.js';

const CACHE_KEY = 'providers';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export async function fetchProviders(
  client: OpenRouterDataClient,
): Promise<OpenRouterProvider[]> {
  const cached = readCache<OpenRouterProvider[]>(CACHE_KEY, CACHE_TTL);
  if (cached) return cached;

  const providers = await client.fetchProviders();
  writeCache(CACHE_KEY, providers);
  return providers;
}
