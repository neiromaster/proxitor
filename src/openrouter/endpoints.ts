import type { OpenRouterDataClient } from './data-client.js'
import type { ModelEndpoint } from './types.js'

export async function fetchModelEndpoints(
  client: OpenRouterDataClient,
  author: string,
  slug: string,
): Promise<ModelEndpoint[]> {
  return client.fetchModelEndpoints(author, slug)
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

  result.sort((a, b) => a.providerName.localeCompare(b.providerName))
  return result
}
