import { describe, expect, it } from 'vitest';
import { isAnthropicModel } from './model.js';

describe('isAnthropicModel', () => {
  it('matches claude-* prefix', () => {
    expect(isAnthropicModel('claude-sonnet-4-6')).toBe(true);
    expect(isAnthropicModel('claude-opus-4')).toBe(true);
  });

  it('matches anthropic/claude-* prefix', () => {
    expect(isAnthropicModel('anthropic/claude-sonnet-4-6')).toBe(true);
    expect(isAnthropicModel('anthropic/claude-opus-4-20250514')).toBe(true);
  });

  it('rejects non-Anthropic models', () => {
    expect(isAnthropicModel('gpt-4o')).toBe(false);
    expect(isAnthropicModel('deepseek/deepseek-r1')).toBe(false);
    expect(isAnthropicModel('meta-llama/llama-3')).toBe(false);
  });

  // Documents intentional narrowing: the old `.includes('claude')` heuristic
  // matched any model whose name contained "claude" anywhere (e.g.
  // "google/claude-3-opus").  The stricter prefix check ensures only genuine
  // Anthropic-hosted models are recognised.
  it('rejects models with "claude" in a non-Anthropic provider prefix', () => {
    expect(isAnthropicModel('google/claude-3-opus')).toBe(false);
    expect(isAnthropicModel('custom/claude-variant')).toBe(false);
  });
});
