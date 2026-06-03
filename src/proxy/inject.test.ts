import { describe, expect, it } from 'vitest'
import { extractModel } from './inject.js'

describe('extractModel', () => {
  it('should extract model from valid JSON body', () => {
    const body = new TextEncoder().encode(
      JSON.stringify({ model: 'claude-sonnet-4-6', messages: [] }),
    )
    expect(extractModel(body.buffer as ArrayBuffer)).toBe('claude-sonnet-4-6')
  })

  it('should return undefined for empty body', () => {
    expect(extractModel(new ArrayBuffer(0))).toBeUndefined()
  })

  it('should return undefined for body without model field', () => {
    const body = new TextEncoder().encode(JSON.stringify({ messages: [] }))
    expect(extractModel(body.buffer as ArrayBuffer)).toBeUndefined()
  })

  it('should return undefined for invalid JSON', () => {
    const body = new TextEncoder().encode('not json')
    expect(extractModel(body.buffer as ArrayBuffer)).toBeUndefined()
  })

  it('should return undefined when model is not a string', () => {
    const body = new TextEncoder().encode(JSON.stringify({ model: 42 }))
    expect(extractModel(body.buffer as ArrayBuffer)).toBeUndefined()
  })
})
