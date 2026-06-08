import { describe, expect, it } from 'vitest';
import {
  buildCacheControl,
  isAnthropicEndpoint,
  shouldInjectCacheControl,
  TTL_SECONDS,
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
    const result = buildCacheControl(
      undefined,
      undefined,
      'claude-sonnet-4-6',
      '/v1/messages',
    );
    expect(result).toEqual({ type: 'ephemeral' });
  });

  it('adds ttl when TTL is set and endpoint is Anthropic', () => {
    const result = buildCacheControl(
      undefined,
      '5m',
      'claude-sonnet-4-6',
      '/v1/messages',
    );
    expect(result).toEqual({ type: 'ephemeral', ttl: 300 });
  });

  it('omits ttl when TTL is set but endpoint is non-Anthropic', () => {
    const result = buildCacheControl(undefined, '5m', 'gpt-4o', '/v1/chat/completions');
    expect(result).toEqual({ type: 'ephemeral' });
    expect(result).not.toHaveProperty('ttl');
  });

  it('overrides ttl on existing cache_control for Anthropic endpoint', () => {
    const existing = { type: 'ephemeral', ttl: 999 };
    const result = buildCacheControl(existing, '1h', 'claude-sonnet-4-6', '/v1/messages');
    expect(result).toEqual({ type: 'ephemeral', ttl: 3600 });
  });

  it('preserves other fields from existing cache_control', () => {
    const existing = { type: 'ephemeral', custom: 'value', count: 42 };
    const result = buildCacheControl(
      existing,
      '5m',
      'claude-sonnet-4-6',
      '/v1/responses',
    );
    expect(result).toEqual({ type: 'ephemeral', custom: 'value', count: 42, ttl: 300 });
  });

  it('does not mutate the original existing object', () => {
    const existing = { type: 'ephemeral' };
    buildCacheControl(existing, '5m', 'claude-sonnet-4-6', '/v1/messages');
    expect(existing).toEqual({ type: 'ephemeral' });
  });

  it('defaults type to ephemeral when existing object lacks it', () => {
    const result = buildCacheControl(
      { ttl: 600 },
      undefined,
      'claude-sonnet-4-6',
      '/v1/messages',
    );
    expect(result).toEqual({ type: 'ephemeral', ttl: 600 });
  });

  it('adds type to object without type even when no TTL is set', () => {
    const result = buildCacheControl(
      { custom: 'value' },
      undefined,
      'claude-sonnet-4-6',
      '/v1/messages',
    );
    expect(result).toEqual({ type: 'ephemeral', custom: 'value' });
  });

  it('treats array existing as no existing — returns default ephemeral', () => {
    const result = buildCacheControl(
      ['ephemeral', '1h'],
      undefined,
      'claude-sonnet-4-6',
      '/v1/messages',
    );
    expect(result).toEqual({ type: 'ephemeral' });
    expect(Object.keys(result)).not.toContain('0');
    expect(Object.keys(result)).not.toContain('1');
  });

  it('treats array existing as no existing — still adds TTL when configured', () => {
    const result = buildCacheControl([], '1h', 'claude-sonnet-4-6', '/v1/messages');
    expect(result).toEqual({ type: 'ephemeral', ttl: 3600 });
  });
});

// ---------------------------------------------------------------------------
// TTL_SECONDS
// ---------------------------------------------------------------------------

describe('TTL_SECONDS', () => {
  it('maps 5m to 300', () => {
    expect(TTL_SECONDS['5m']).toBe(300);
  });

  it('maps 1h to 3600', () => {
    expect(TTL_SECONDS['1h']).toBe(3600);
  });
});
