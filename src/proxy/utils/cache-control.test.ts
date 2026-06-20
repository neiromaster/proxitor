import { describe, expect, it } from 'vitest';
import {
  buildCacheControl,
  isAnthropicEndpoint,
  rewriteBlockTtls,
  shouldInjectCacheControl,
  shouldRewriteBlockTtl,
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
  it('returns false for "skip" mode', () => {
    expect(shouldInjectCacheControl('skip', 'claude-sonnet-4-6', '/v1/messages')).toBe(
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

  it('preserves client ttl when TTL is skip (passthrough)', () => {
    const existing = { type: 'ephemeral', ttl: '5m' };
    const result = buildCacheControl(existing, 'skip', true);
    expect(result).toEqual({ type: 'ephemeral', ttl: '5m' });
  });

  it('does not add ttl when TTL is skip and none existed', () => {
    const result = buildCacheControl(undefined, 'skip', true);
    expect(result).toEqual({ type: 'ephemeral' });
    expect(result).not.toHaveProperty('ttl');
  });
});

// ---------------------------------------------------------------------------
// shouldRewriteBlockTtl
// ---------------------------------------------------------------------------

describe('shouldRewriteBlockTtl', () => {
  it('returns false for "skip"', () => {
    expect(
      shouldRewriteBlockTtl('skip', 'auto', 'claude-sonnet-4-6', '/v1/messages'),
    ).toBe(false);
  });

  it('returns true for "always" regardless of endpoint', () => {
    expect(
      shouldRewriteBlockTtl('always', 'auto', 'gpt-4o', '/v1/chat/completions'),
    ).toBe(true);
  });

  it('returns true for "auto" on an Anthropic endpoint with active injection', () => {
    expect(
      shouldRewriteBlockTtl('auto', 'auto', 'claude-sonnet-4-6', '/v1/messages'),
    ).toBe(true);
  });

  it('returns false for "auto" on a non-Anthropic endpoint', () => {
    expect(shouldRewriteBlockTtl('auto', 'auto', 'gpt-4o', '/v1/chat/completions')).toBe(
      false,
    );
  });

  it('returns false for "auto" when cacheControl is skip (no injection)', () => {
    expect(
      shouldRewriteBlockTtl('auto', 'skip', 'claude-sonnet-4-6', '/v1/messages'),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rewriteBlockTtls
// ---------------------------------------------------------------------------

describe('rewriteBlockTtls', () => {
  it('sets ttl on every existing block breakpoint to the configured TTL (Anthropic)', () => {
    const body = {
      system: [
        { type: 'text', text: 's1', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 's2', cache_control: { type: 'ephemeral', ttl: '5m' } },
      ],
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }],
        },
      ],
    };
    const mutated = rewriteBlockTtls(body, '1h', true);
    expect(mutated).toBe(true);
    expect(body.system[0]!.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(body.system[1]!.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(body.messages[0]!.content[0]!.cache_control).toEqual({
      type: 'ephemeral',
      ttl: '1h',
    });
  });

  it('walks tools blocks too', () => {
    const body = {
      tools: [{ name: 't', cache_control: { type: 'ephemeral' } }],
    };
    rewriteBlockTtls(body, '1h', true);
    expect(body.tools[0]!.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('does not add new breakpoints — only touches existing cache_control', () => {
    const body = {
      system: [
        { type: 'text', text: 'no-cc-here' },
        { type: 'text', text: 'has-cc', cache_control: { type: 'ephemeral' } },
      ],
    };
    rewriteBlockTtls(body, '1h', true);
    expect(body.system[0]).not.toHaveProperty('cache_control');
    expect(body.system[1]!.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('strips ttl from all blocks when TTL is omit', () => {
    const body = {
      system: [
        { type: 'text', text: 's', cache_control: { type: 'ephemeral', ttl: '1h' } },
      ],
    };
    const mutated = rewriteBlockTtls(body, 'omit', true);
    expect(mutated).toBe(true);
    expect(body.system[0]!.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('is a no-op and reports no mutation when TTL is skip (passthrough)', () => {
    const block = { type: 'ephemeral', ttl: '5m' };
    const body = { system: [{ type: 'text', text: 's', cache_control: block }] };
    const mutated = rewriteBlockTtls(body, 'skip', true);
    expect(mutated).toBe(false);
    expect(body.system[0]!.cache_control).toBe(block);
  });

  it('is a no-op when TTL is undefined', () => {
    const body = {
      system: [{ type: 'text', text: 's', cache_control: { type: 'ephemeral' } }],
    };
    expect(rewriteBlockTtls(body, undefined, true)).toBe(false);
  });

  it('does not add ttl on non-Anthropic endpoints', () => {
    const body = {
      system: [{ type: 'text', text: 's', cache_control: { type: 'ephemeral' } }],
    };
    rewriteBlockTtls(body, '1h', false);
    expect(body.system[0]!.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('handles string system prompt (no blocks) without throwing', () => {
    const body = { system: 'just a string' };
    expect(rewriteBlockTtls(body, '1h', true)).toBe(false);
  });

  it('handles missing system/tools/messages without throwing', () => {
    expect(rewriteBlockTtls({}, '1h', true)).toBe(false);
  });

  it('normalizes cache_control on nested tool_result content blocks', () => {
    const body = {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              content: [
                { type: 'text', text: 'nested', cache_control: { type: 'ephemeral' } },
              ],
            },
          ],
        },
      ],
    };
    const mutated = rewriteBlockTtls(body, '1h', true);
    expect(mutated).toBe(true);
    expect(
      (
        body.messages[0]!.content as Array<{
          content: Array<{ cache_control?: { ttl?: string } }>;
        }>
      )[0]!.content[0]!.cache_control?.ttl,
    ).toBe('1h');
  });

  it('does not touch a cache_control key nested inside a tool input_schema', () => {
    const schemaFragment = { cache_control: { type: 'string', description: 'x' } };
    const body = {
      tools: [
        {
          name: 't',
          input_schema: { type: 'object', properties: schemaFragment },
          cache_control: { type: 'ephemeral' },
        },
      ],
    };
    rewriteBlockTtls(body, '1h', true);
    // The tool's own breakpoint is normalized...
    expect(body.tools[0]!.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    // ...but the nested schema fragment is left untouched (would be corrupted by a general walk).
    expect(schemaFragment.cache_control).toEqual({ type: 'string', description: 'x' });
  });
});
