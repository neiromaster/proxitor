import type { CanonicalRequest } from '@proxitor/plugin-api';
import { describe, expect, it } from 'vitest';
import {
  type CacheControlPluginConfig,
  createCacheControlPlugin,
} from './cache-control.js';

type RawConfig = {
  cacheControl?: 'auto' | 'always' | 'skip';
  ttl?: '5m' | '1h' | 'omit';
  rewriteBlockTtl?: 'auto' | 'skip';
};

function request(overrides: Partial<CanonicalRequest> = {}): CanonicalRequest {
  return {
    model: { logical: 'm', physical: 'm' },
    system: [{ type: 'text', text: 'sys' }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    params: {},
    stream: false,
    extensions: {},
    ...overrides,
  };
}

function ctx(config: RawConfig = {}) {
  return {
    requestId: 'r1',
    logger: console,
    clock: { now: () => 0 },
    random: { uuid: () => 'u' },
    config: config as CacheControlPluginConfig,
  };
}

describe('cache-control config parsing', () => {
  it('defaults cacheControl and rewriteBlockTtl and accepts undefined (bare declaration)', () => {
    // Arrange
    const plugin = createCacheControlPlugin();

    // Act
    const config = plugin.validateConfig?.(undefined);

    // Assert
    expect(config).toEqual({ cacheControl: 'auto', rewriteBlockTtl: 'auto' });
  });

  it('parses the spec §6 example shape', () => {
    // Arrange
    const plugin = createCacheControlPlugin();

    // Act
    const config = plugin.validateConfig?.({
      cacheControl: 'auto',
      rewriteBlockTtl: 'auto',
    });

    // Assert
    expect(config).toEqual({ cacheControl: 'auto', rewriteBlockTtl: 'auto' });
  });
});

describe('cache-control injection', () => {
  it('auto leaves a request without breakpoints untouched (same reference)', async () => {
    // Arrange
    const req = request();

    // Act
    const result = await createCacheControlPlugin().onRequest?.(ctx({}), req);

    // Assert
    expect(result).toBe(req);
  });

  it('always marks the last system block with the configured ttl', async () => {
    // Arrange
    const req = request({
      system: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ],
    });

    // Act
    const result = (await createCacheControlPlugin().onRequest?.(
      ctx({ cacheControl: 'always', ttl: '1h' }),
      req,
    )) as CanonicalRequest | undefined;

    // Assert
    expect(result?.system[0]?.cacheControl).toBeUndefined();
    expect(result?.system[1]?.cacheControl).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('auto injects when a breakpoint already exists elsewhere (last message block)', async () => {
    // Arrange
    const req = request({
      system: [],
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'first', cacheControl: { type: 'ephemeral' } }],
        },
        { role: 'assistant', content: [{ type: 'text', text: 'reply' }] },
        { role: 'user', content: [{ type: 'text', text: 'second' }] },
      ],
    });

    // Act
    const result = (await createCacheControlPlugin().onRequest?.(
      ctx({ ttl: '1h' }),
      req,
    )) as CanonicalRequest | undefined;

    // Assert — rewrite normalized the existing mark; inject marked the LAST message
    expect(result?.messages[0]?.content[0]?.cacheControl).toEqual({
      type: 'ephemeral',
      ttl: '1h',
    });
    expect(result?.messages[2]?.content[0]?.cacheControl).toEqual({
      type: 'ephemeral',
      ttl: '1h',
    });
  });

  it('falls back to the last tool when system and messages carry no content', async () => {
    // Arrange
    const req = request({
      system: [],
      messages: [],
      tools: [
        { name: 't1', inputSchema: {}, cacheControl: { type: 'ephemeral', ttl: '5m' } },
        { name: 't2', inputSchema: {} },
      ],
    });

    // Act
    const result = (await createCacheControlPlugin().onRequest?.(
      ctx({ cacheControl: 'always' }),
      req,
    )) as CanonicalRequest | undefined;

    // Assert
    expect(result?.tools?.[0]?.cacheControl).toEqual({ type: 'ephemeral', ttl: '5m' });
    expect(result?.tools?.[1]?.cacheControl).toEqual({ type: 'ephemeral' });
  });

  it('does not overwrite an existing mark on the injection target', async () => {
    // Arrange
    const marked = {
      type: 'text' as const,
      text: 'sys',
      cacheControl: { type: 'ephemeral' as const },
    };
    const req = request({ system: [marked] });

    // Act
    const result = (await createCacheControlPlugin().onRequest?.(
      ctx({ cacheControl: 'always', ttl: '1h' }),
      req,
    )) as CanonicalRequest | undefined;

    // Assert — rewrite normalized ttl; inject added nothing
    expect(result?.system).toHaveLength(1);
    expect(result?.system[0]?.cacheControl).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('skip never injects', async () => {
    // Arrange
    const req = request({
      system: [
        { type: 'text', text: 'a', cacheControl: { type: 'ephemeral', ttl: '5m' } },
      ],
    });

    // Act
    const result = (await createCacheControlPlugin().onRequest?.(
      ctx({ cacheControl: 'skip', ttl: '1h' }),
      req,
    )) as CanonicalRequest | undefined;

    // Assert — rewrite still ran (independent knob)
    expect(result?.system[0]?.cacheControl).toEqual({ type: 'ephemeral', ttl: '1h' });
  });
});

describe('cache-control TTL rewrite', () => {
  it('rewrites existing marks in nested tool_result content', async () => {
    // Arrange
    const req = request({
      system: [],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              toolUseId: 't1',
              content: [
                {
                  type: 'text',
                  text: 'inner',
                  cacheControl: { type: 'ephemeral', ttl: '5m' },
                },
              ],
            },
          ],
        },
      ],
    });

    // Act
    const result = (await createCacheControlPlugin().onRequest?.(
      ctx({ cacheControl: 'skip', ttl: '1h' }),
      req,
    )) as CanonicalRequest | undefined;

    // Assert
    const outer = result?.messages[0]?.content[0];
    expect(outer?.type).toBe('tool_result');
    if (outer?.type === 'tool_result' && Array.isArray(outer.content)) {
      expect(outer.content[0]?.cacheControl).toEqual({ type: 'ephemeral', ttl: '1h' });
    }
  });

  it('omit strips ttl from existing marks', async () => {
    // Arrange
    const req = request({
      system: [
        { type: 'text', text: 'a', cacheControl: { type: 'ephemeral', ttl: '1h' } },
      ],
    });

    // Act
    const result = (await createCacheControlPlugin().onRequest?.(
      ctx({ ttl: 'omit' }),
      req,
    )) as CanonicalRequest | undefined;

    // Assert
    expect(result?.system[0]?.cacheControl).toEqual({ type: 'ephemeral' });
  });

  it('leaves marks alone without a configured ttl and rewriteBlockTtl skip wins', async () => {
    // Arrange
    const mark = { type: 'ephemeral' as const, ttl: '5m' as const };
    const reqA = request({ system: [{ type: 'text', text: 'a', cacheControl: mark }] });
    const reqB = request({ system: [{ type: 'text', text: 'a', cacheControl: mark }] });

    // Act
    const noTtl = (await createCacheControlPlugin().onRequest?.(ctx({}), reqA)) as
      | CanonicalRequest
      | undefined;
    const skipRewrite = (await createCacheControlPlugin().onRequest?.(
      ctx({ ttl: '1h', rewriteBlockTtl: 'skip' }),
      reqB,
    )) as CanonicalRequest | undefined;

    // Assert
    expect(noTtl?.system[0]?.cacheControl).toEqual({ type: 'ephemeral', ttl: '5m' });
    expect(skipRewrite?.system[0]?.cacheControl).toEqual({
      type: 'ephemeral',
      ttl: '5m',
    });
  });
});
