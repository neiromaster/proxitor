import { describe, expect, it } from 'vitest';
import { extractModel, isAnthropicModel } from './inject.js';

describe('extractModel', () => {
  it('should extract model from valid JSON body', () => {
    const body = new TextEncoder().encode(
      JSON.stringify({ model: 'claude-sonnet-4-6', messages: [] }),
    );
    expect(extractModel(body.buffer as ArrayBuffer)).toBe('claude-sonnet-4-6');
  });

  it('should return undefined for empty body', () => {
    expect(extractModel(new ArrayBuffer(0))).toBeUndefined();
  });

  it('should return undefined for body without model field', () => {
    const body = new TextEncoder().encode(JSON.stringify({ messages: [] }));
    expect(extractModel(body.buffer as ArrayBuffer)).toBeUndefined();
  });

  it('should return undefined for invalid JSON', () => {
    const body = new TextEncoder().encode('not json');
    expect(extractModel(body.buffer as ArrayBuffer)).toBeUndefined();
  });

  it('should return undefined when model is not a string', () => {
    const body = new TextEncoder().encode(JSON.stringify({ model: 42 }));
    expect(extractModel(body.buffer as ArrayBuffer)).toBeUndefined();
  });
});

describe('isAnthropicModel', () => {
  it('matches claude-* prefix', () => {
    expect(isAnthropicModel('claude-sonnet-4-6')).toBe(true);
    expect(isAnthropicModel('claude-opus-4')).toBe(true);
  });

  it('matches anthropic/claude-* prefix', () => {
    expect(isAnthropicModel('anthropic/claude-sonnet-4-6')).toBe(true);
    expect(isAnthropicModel('anthropic/claude-opus-4-20250514')).toBe(true);
  });

  it('matches models containing claude', () => {
    expect(isAnthropicModel('google/claude-3-opus')).toBe(true);
  });

  it('rejects non-Anthropic models', () => {
    expect(isAnthropicModel('gpt-4o')).toBe(false);
    expect(isAnthropicModel('deepseek/deepseek-r1')).toBe(false);
    expect(isAnthropicModel('meta-llama/llama-3')).toBe(false);
  });
});
