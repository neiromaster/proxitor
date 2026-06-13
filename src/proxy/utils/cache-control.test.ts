import { describe, expect, it } from 'vitest';
import {
  buildCacheControl,
  isAnthropicEndpoint,
  shouldInjectCacheControl,
} from './cache-control.js';

// ---------------------------------------------------------------------------
// isAnthropicEndpoint
// ---------------------------------------------------------------------------

describe('isAnthropicEndpoint', () => {
  it('returns true for /v1/messages', () => {
    expect(isAnthropicEndpoint('gpt-4o', '/v1/messages')).toBe(true);
  });

  it('returns true for /v1/responses', () => {
    expect(isAnthropicEndpoint('gpt-4o', '/v1/responses')).toBe(true);
  });

  it('returns true for chat-completions with a claude model', () => {
    expect(isAnthropicEndpoint('claude-sonnet-4-6', '/v1/chat/completions')).toBe(true);
  });

  it('returns false for chat-completions with a non-claude model', () => {
    expect(isAnthropicEndpoint('gpt-4o', '/v1/chat/completions')).toBe(false);
  });

  it('returns false for unknown paths with a non-claude model', () => {
    expect(isAnthropicEndpoint('gpt-4o', '/v1/embeddings')).toBe(false);
  });

  it('returns true for chat-completions with anthropic/claude-* model', () => {
    expect(isAnthropicEndpoint('anthropic/claude-opus-4', '/v1/chat/completions')).toBe(
      true,
    );
  });

  it('handles undefined model name gracefully', () => {
    expect(isAnthropicEndpoint(undefined, '/v1/messages')).toBe(true);
    expect(isAnthropicEndpoint(undefined, '/v1/chat/completions')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldInjectCacheControl
// ---------------------------------------------------------------------------

describe('shouldInjectCacheControl', () => {
  it('returns false for "never" mode', () => {
    expect(shouldInjectCacheControl('never', 'claude-sonnet-4-6', '/v1/messages')).toBe(
      false,
    );
  });

  it('returns true for "always" mode regardless of model or path', () => {
    expect(shouldInjectCacheControl('always', 'gpt-4o', '/v1/chat/completions')).toBe(
      true,
    );
  });

  it('returns true for "auto" mode with Anthropic endpoint', () => {
    expect(
      shouldInjectCacheControl('auto', 'claude-sonnet-4-6', '/v1/chat/completions'),
    ).toBe(true);
  });

  it('returns false for "auto" mode with non-Anthropic endpoint', () => {
    expect(shouldInjectCacheControl('auto', 'gpt-4o', '/v1/chat/completions')).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// buildCacheControl
// ---------------------------------------------------------------------------

describe('buildCacheControl', () => {
  it('returns default ephemeral when no existing and no TTL', () => {
    const result = buildCacheControl(undefined, undefined, true);
    expect(result).toEqual({ type: 'ephemeral' });
  });

  it('adds ttl string when TTL is set and endpoint is Anthropic', () => {
    const result = buildCacheControl(undefined, '5m', true);
    expect(result).toEqual({ type: 'ephemeral', ttl: '5m' });
  });

  it('omits ttl when TTL is set but endpoint is non-Anthropic', () => {
    const result = buildCacheControl(undefined, '5m', false);
    expect(result).toEqual({ type: 'ephemeral' });
    expect(result).not.toHaveProperty('ttl');
  });

  it('overrides ttl on existing cache_control for Anthropic endpoint', () => {
    const existing = { type: 'ephemeral', ttl: '5m' };
    const result = buildCacheControl(existing, '1h', true);
    expect(result).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('preserves other fields from existing cache_control', () => {
    const existing = { type: 'ephemeral', custom: 'value', count: 42 };
    const result = buildCacheControl(existing, '5m', true);
    expect(result).toEqual({ type: 'ephemeral', custom: 'value', count: 42, ttl: '5m' });
  });

  it('does not mutate the original existing object', () => {
    const existing = { type: 'ephemeral' };
    buildCacheControl(existing, '5m', true);
    expect(existing).toEqual({ type: 'ephemeral' });
  });

  it('defaults type to ephemeral when existing object lacks it', () => {
    const result = buildCacheControl({ ttl: 600 }, undefined, true);
    expect(result).toEqual({ type: 'ephemeral', ttl: 600 });
  });

  it('adds type to object without type even when no TTL is set', () => {
    const result = buildCacheControl({ custom: 'value' }, undefined, true);
    expect(result).toEqual({ type: 'ephemeral', custom: 'value' });
  });

  it('uses 1h TTL string for Anthropic endpoint', () => {
    const result = buildCacheControl(undefined, '1h', true);
    expect(result).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('treats array existing as no existing — returns default ephemeral', () => {
    const result = buildCacheControl(['ephemeral', '1h'] as unknown, undefined, true);
    expect(result).toEqual({ type: 'ephemeral' });
    expect(Object.keys(result)).not.toContain('0');
    expect(Object.keys(result)).not.toContain('1');
  });

  it('treats array existing as no existing — still adds TTL when configured', () => {
    const result = buildCacheControl([] as unknown, '1h', true);
    expect(result).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('strips ttl when TTL is omit (Anthropic)', () => {
    const existing = { type: 'ephemeral', ttl: '5m' };
    const result = buildCacheControl(existing, 'omit', true);
    expect(result).toEqual({ type: 'ephemeral' });
    expect(result).not.toHaveProperty('ttl');
  });

  it('strips ttl when TTL is omit even on non-Anthropic endpoint', () => {
    const existing = { type: 'ephemeral', ttl: '5m' };
    const result = buildCacheControl(existing, 'omit', false);
    expect(result).toEqual({ type: 'ephemeral' });
    expect(result).not.toHaveProperty('ttl');
  });

  it('preserves client ttl when TTL is never (passthrough)', () => {
    const existing = { type: 'ephemeral', ttl: '5m' };
    const result = buildCacheControl(existing, 'never', true);
    expect(result).toEqual({ type: 'ephemeral', ttl: '5m' });
  });

  it('never adds ttl when TTL is never and none existed', () => {
    const result = buildCacheControl(undefined, 'never', true);
    expect(result).toEqual({ type: 'ephemeral' });
    expect(result).not.toHaveProperty('ttl');
  });
});
