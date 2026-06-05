import type { AuthType } from '../config-schema.js'
import { OpenRouterClient } from './client.js'
import type { ModelEndpoint, OpenRouterModel, OpenRouterProvider } from './types.js'

const OPENROUTER_FALLBACK_URL = 'https://openrouter.ai/api/v1'

export type DataClientConfig = {
  openrouterBaseUrl: string
  openrouterDataUrl?: string
  apiKey: string
  authType: AuthType
  onFallback?: (path: string) => void
}

type FallbackResult<T> = {
  data: T
  usedFallback: boolean
}

function isValidProvidersResponse(data: unknown): data is { data: OpenRouterProvider[] } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'data' in data &&
    Array.isArray((data as { data: unknown }).data)
  )
}

function isValidModelsResponse(data: unknown): data is { data: OpenRouterModel[] } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'data' in data &&
    Array.isArray((data as { data: unknown }).data)
  )
}

function isValidEndpointsResponse(data: unknown): data is {
  data: { endpoints: ModelEndpoint[] }
} {
  return (
    typeof data === 'object' &&
    data !== null &&
    'data' in data &&
    typeof (data as { data: unknown }).data === 'object' &&
    (data as { data: unknown }).data !== null &&
    'endpoints' in ((data as { data: unknown }).data as object) &&
    Array.isArray((data as { data: { endpoints: unknown } }).data.endpoints)
  )
}

/**
 * Client for fetching provider/model data with automatic fallback to OpenRouter.
 *
 * When the primary API (openrouterDataUrl or openrouterBaseUrl) doesn't support
 * OpenRouter-specific data endpoints, falls back to https://openrouter.ai/api/v1
 * which hosts public, unauthenticated endpoints for /providers, /models, etc.
 */
export class OpenRouterDataClient {
  private primaryClient: OpenRouterClient
  private fallbackClient: OpenRouterClient
  private skipFallback: boolean
  private onFallback?: (path: string) => void

  constructor(config: DataClientConfig) {
    const primaryUrl = config.openrouterDataUrl ?? config.openrouterBaseUrl
    this.skipFallback = primaryUrl === OPENROUTER_FALLBACK_URL
    this.primaryClient = new OpenRouterClient(config.apiKey, primaryUrl, config.authType)
    this.fallbackClient = new OpenRouterClient(OPENROUTER_FALLBACK_URL)
    this.onFallback = config.onFallback
  }

  async fetchProviders(): Promise<OpenRouterProvider[]> {
    const result = await this.withFallback(
      '/providers',
      () => this.primaryClient.get<unknown>('/providers'),
      isValidProvidersResponse,
    )
    return result.data.data
  }

  async fetchModels(): Promise<OpenRouterModel[]> {
    const result = await this.withFallback(
      '/models',
      () => this.primaryClient.get<unknown>('/models'),
      isValidModelsResponse,
    )
    return result.data.data
  }

  async fetchModelEndpoints(author: string, slug: string): Promise<ModelEndpoint[]> {
    const path = `/models/${author}/${slug}/endpoints`
    const result = await this.withFallback(
      path,
      () => this.primaryClient.get<unknown>(path),
      isValidEndpointsResponse,
    )
    return result.data.data.endpoints ?? []
  }

  /**
   * Try primary, validate response, fallback on failure.
   * Network errors get 1 retry before fallback.
   */
  private async withFallback<T>(
    path: string,
    primaryFn: () => Promise<unknown>,
    validate: (data: unknown) => data is T,
  ): Promise<FallbackResult<T>> {
    if (this.skipFallback) {
      const data = await primaryFn()
      if (!validate(data)) {
        throw new Error(`Unexpected response format from primary API for ${path}`)
      }
      return { data, usedFallback: false }
    }

    // Try primary with 1 retry on network errors
    try {
      const data = await primaryFn()
      if (validate(data)) {
        return { data, usedFallback: false }
      }
      // Valid HTTP response but unexpected format — fall through to fallback
    } catch (error) {
      if (error instanceof Error && isNetworkError(error)) {
        // Retry once on network errors
        try {
          const data = await primaryFn()
          if (validate(data)) {
            return { data, usedFallback: false }
          }
        } catch {
          // Retry also failed — fall through to fallback
        }
      }
      // Non-network errors (4xx, 5xx) — fall through to fallback
    }

    // Fallback to OpenRouter
    this.onFallback?.(path)
    const data = await this.fallbackClient.get<unknown>(path)
    if (!validate(data)) {
      throw new Error(`Unexpected response format from OpenRouter fallback for ${path}`)
    }
    return { data, usedFallback: true }
  }
}

function isNetworkError(error: Error): boolean {
  const message = error.message.toLowerCase()
  return (
    message.includes('fetch') ||
    message.includes('network') ||
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('timeout') ||
    message.includes('aborted') ||
    error.name === 'TypeError'
  )
}
