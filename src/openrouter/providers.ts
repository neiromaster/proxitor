import { readCache, writeCache } from './cache.js'
import type { OpenRouterClient } from './client.js'
import type { OpenRouterProvider, OpenRouterProvidersResponse } from './types.js'

const CACHE_KEY = 'providers'
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

export async function fetchProviders(
  client: OpenRouterClient,
): Promise<OpenRouterProvider[]> {
  const cached = readCache<OpenRouterProvider[]>(CACHE_KEY, CACHE_TTL)
  if (cached) return cached

  const response = await client.get<OpenRouterProvidersResponse>('/providers')
  writeCache(CACHE_KEY, response.data)
  return response.data
}
