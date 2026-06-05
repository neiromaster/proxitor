import { describe, expect, it } from 'vitest'
import { OpenRouterClient } from '../../src/openrouter/client.js'

describe('OpenRouterClient', () => {
  it('creates authenticated client with 3 args', () => {
    const client = new OpenRouterClient('sk-test', 'https://example.com/v1', 'bearer')
    expect(client).toBeInstanceOf(OpenRouterClient)
  })

  it('creates unauthenticated client with 1 arg', () => {
    const client = new OpenRouterClient('https://example.com/v1')
    expect(client).toBeInstanceOf(OpenRouterClient)
  })
})
