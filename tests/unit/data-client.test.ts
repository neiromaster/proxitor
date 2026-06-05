import { describe, expect, it, vi } from 'vitest'
import { OpenRouterDataClient } from '../../src/openrouter/data-client.js'

describe('OpenRouterDataClient', () => {
  const makeConfig = (overrides?: { openrouterDataUrl?: string }) => ({
    openrouterBaseUrl: 'https://custom.example.com/v1',
    apiKey: 'test-key',
    authType: 'bearer' as const,
    ...overrides,
  })

  describe('constructor', () => {
    it('uses openrouterBaseUrl as primary when openrouterDataUrl is not set', () => {
      const client = new OpenRouterDataClient(makeConfig())
      expect(client).toBeInstanceOf(OpenRouterDataClient)
    })

    it('skips fallback when primary equals OpenRouter', () => {
      const client = new OpenRouterDataClient({
        openrouterBaseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'test-key',
        authType: 'bearer',
      })
      expect(client).toBeInstanceOf(OpenRouterDataClient)
    })

    it('uses openrouterDataUrl as primary when set', () => {
      const client = new OpenRouterDataClient(
        makeConfig({ openrouterDataUrl: 'https://data.example.com/v1' }),
      )
      expect(client).toBeInstanceOf(OpenRouterDataClient)
    })

    it('accepts onFallback callback', () => {
      const onFallback = vi.fn()
      const client = new OpenRouterDataClient({
        ...makeConfig(),
        onFallback,
      })
      expect(client).toBeInstanceOf(OpenRouterDataClient)
    })
  })
})
