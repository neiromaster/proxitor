import { describe, expect, it } from 'vitest'
import type { ProxyConfig } from '../config.js'
import { buildRequestHeaders } from './headers.js'

const baseConfig: ProxyConfig = {
  host: '0.0.0.0',
  port: 8080,
  openrouterKey: 'test-key',
  openrouterBaseUrl: 'https://openrouter.ai/api/v1',
  verbose: false,
  bodyLimit: '50mb',
  attributionReferer: 'http://localhost',
  attributionTitle: 'proxitor',
}

describe('buildRequestHeaders', () => {
  it('should build basic headers without extraHeaders', () => {
    const incoming = new Headers()
    const headers = buildRequestHeaders(incoming, baseConfig, false)
    expect(headers.Authorization).toBe('Bearer test-key')
    expect(headers['HTTP-Referer']).toBe('http://localhost')
    expect(headers['X-Title']).toBe('proxitor')
    expect(headers['Accept-Encoding']).toBe('identity')
  })

  it('should apply extraHeaders on top of standard headers', () => {
    const incoming = new Headers()
    const headers = buildRequestHeaders(incoming, baseConfig, false, {
      'X-Custom': 'model-specific',
    })
    expect(headers['X-Custom']).toBe('model-specific')
    expect(headers.Authorization).toBe('Bearer test-key')
  })

  it('should set Content-Type when inject is true', () => {
    const incoming = new Headers()
    const headers = buildRequestHeaders(incoming, baseConfig, true)
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('should not set Content-Type when inject is false', () => {
    const incoming = new Headers()
    const headers = buildRequestHeaders(incoming, baseConfig, false)
    expect(headers['Content-Type']).toBeUndefined()
  })

  it('should strip authorization and host from incoming headers', () => {
    const incoming = new Headers({
      authorization: 'Bearer old-token',
      host: 'example.com',
      'x-forwarded-for': '1.2.3.4',
    })
    const headers = buildRequestHeaders(incoming, baseConfig, false)
    expect(headers.authorization).toBeUndefined()
    expect(headers.host).toBeUndefined()
    expect(headers['x-forwarded-for']).toBe('1.2.3.4')
  })
})
