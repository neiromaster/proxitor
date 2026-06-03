import { afterEach, describe, expect, it } from 'vitest'
import { createTestEnv, type TestEnv } from '../helpers.js'

describe('Error Handling', () => {
  let env: TestEnv

  afterEach(async () => {
    if (env) await env.cleanup()
  })

  it('returns 502 when upstream is unreachable', async () => {
    env = await createTestEnv({
      openrouterBaseUrl: 'http://127.0.0.1:1',
    })

    const res = await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    })

    expect(res.status).toBe(502)
    const data = await res.json()
    expect(data.error.type).toBe('proxy_upstream_error')
  })

  it('passes through upstream 500 status', async () => {
    env = await createTestEnv(undefined, upstream => {
      upstream.all('/*', () => {
        return new Response(
          JSON.stringify({ error: { message: 'Internal error', type: 'server_error' } }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        )
      })
    })

    const res = await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    })

    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error.type).toBe('server_error')
  })

  it('passes through upstream 429 rate limit', async () => {
    env = await createTestEnv(undefined, upstream => {
      upstream.all('/*', () => {
        return new Response(
          JSON.stringify({ error: { message: 'Rate limited', type: 'rate_limit' } }),
          { status: 429, headers: { 'Content-Type': 'application/json' } },
        )
      })
    })

    const res = await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    })

    expect(res.status).toBe(429)
  })

  it('returns 502 when upstream returns non-JSON error', async () => {
    env = await createTestEnv(undefined, upstream => {
      upstream.all('/*', () => {
        return new Response('Bad Gateway', { status: 502 })
      })
    })

    const res = await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    })

    expect(res.status).toBe(502)
  })
})
