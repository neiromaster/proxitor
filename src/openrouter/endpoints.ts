import type { OpenRouterClient } from './client.js'
import type { ModelEndpoint, ModelEndpointsResponse } from './types.js'

export async function fetchModelEndpoints(
  client: OpenRouterClient,
  author: string,
  slug: string,
): Promise<ModelEndpoint[]> {
  const response = await client.get<ModelEndpointsResponse>(
    `/models/${author}/${slug}/endpoints`,
  )
  return response.data.endpoints ?? []
}

export type ProviderOption = {
  providerName: string
  /** Routing slug for `provider.only/order/ignore` (e.g. "anthropic", "google-vertex/global"). */
  tag: string
}

export function getUniqueProviders(endpoints: ModelEndpoint[]): ProviderOption[] {
  const seen = new Set<string>()
  const result: ProviderOption[] = []

  for (const ep of endpoints) {
    if (seen.has(ep.tag)) continue
    seen.add(ep.tag)
    result.push({ tag: ep.tag, providerName: ep.provider_name })
  }

  return result
}
