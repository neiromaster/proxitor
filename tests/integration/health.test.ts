import { afterEach, describe, expect, it } from 'vitest'
import { createTestEnv, type TestEnv } from '../helpers.js'

describe('Health Endpoint', () => {
  let env: TestEnv

  afterEach(async () => {
    if (env) await env.cleanup()
  })

  it('returns ok with config info', async () => {
    env = await createTestEnv({
      provider: { only: 'anthropic' },
      modelOverrides: {
        'claude-*': { provider: { only: 'deepinfra' } },
      },
    })

    const res = await fetch(`${env.proxyUrl}/health`)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.provider).toEqual({ only: ['anthropic'] })
    expect(data.modelOverrides).toEqual(['claude-*'])
    expect(data.upstream).toContain('127.0.0.1')
  })

  it('returns "not configured" when no provider is set', async () => {
    env = await createTestEnv()

    const res = await fetch(`${env.proxyUrl}/health`)
    const data = await res.json()

    expect(data.ok).toBe(true)
    expect(data.provider).toBe('not configured')
    expect(data.modelOverrides).toEqual([])
  })
})
