import { describe, expect, it } from 'vitest';
import { isAnthropicModel } from './inject.js';

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
