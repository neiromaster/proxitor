import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

describe('loadConfig', () => {
  it('should use defaults when no config provided', async () => {
    const config = await loadConfig({
      openrouterKey: 'test-key',
    })
    expect(config.host).toBe('0.0.0.0')
    expect(config.port).toBe(8080)
    expect(config.openrouterKey).toBe('test-key')
    expect(config.verbose).toBe(false)
  })

  it('should accept CLI options', async () => {
    const config = await loadConfig({
      host: '127.0.0.1',
      port: 3000,
      openrouterKey: 'test-key',
      verbose: true,
    })
    expect(config.host).toBe('127.0.0.1')
    expect(config.port).toBe(3000)
    expect(config.verbose).toBe(true)
  })

  it('should throw if no API key is provided', async () => {
    delete process.env.OPENROUTER_API_KEY
    await expect(loadConfig({})).rejects.toThrow('OpenRouter API key is required')
  })
})
