// src/proxy/observability/extract.test.ts
import { describe, expect, it } from 'vitest';
import {
  extractFromFullText,
  parseRouting,
  parseUsage,
  SseUsageAccumulator,
} from './extract.js';

describe('parseUsage', () => {
  it('parses Anthropic usage and reconstructs inputTokens', () => {
    const u = parseUsage({
      usage: {
        input_tokens: 1000,
        cache_read_input_tokens: 4000,
        cache_creation_input_tokens: 500,
      },
    });
    expect(u).toEqual({
      present: true,
      inputTokens: 5500,
      cacheRead: 4000,
      cacheCreate: 500,
    });
  });
  it('parses OpenAI usage (prompt_tokens inclusive of cached)', () => {
    const u = parseUsage({
      usage: { prompt_tokens: 48874, prompt_tokens_details: { cached_tokens: 48640 } },
    });
    expect(u).toEqual({
      present: true,
      inputTokens: 48874,
      cacheRead: 48640,
      cacheCreate: 0,
    });
  });
  it('returns present:true with zeros on a pure miss (Anthropic)', () => {
    const u = parseUsage({
      usage: {
        input_tokens: 61322,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    });
    expect(u).toEqual({
      present: true,
      inputTokens: 61322,
      cacheRead: 0,
      cacheCreate: 0,
    });
  });
  it('unwraps Anthropic SSE message_start/message_delta containers', () => {
    const u = parseUsage({ message: { usage: { input_tokens: 10 } } });
    expect(u?.inputTokens).toBe(10);
  });
  it('returns undefined when no usage object', () => {
    expect(parseUsage({ choices: [] })).toBeUndefined();
  });
});

describe('parseRouting', () => {
  it('reads selected provider + generation id + fallback flag', () => {
    const r = parseRouting({
      id: 'gen-123',
      openrouter_metadata: {
        strategy: 'direct',
        attempt: 2,
        endpoints: {
          available: [
            { provider: 'OpenAI', selected: false },
            { provider: 'Azure', selected: true },
          ],
        },
      },
    });
    expect(r).toEqual({
      provider: 'Azure',
      strategy: 'direct',
      region: undefined,
      attempt: 2,
      fallback: true,
      generationId: 'gen-123',
    });
  });
  it('falls back to last attempt when no selected endpoint', () => {
    const r = parseRouting({
      openrouter_metadata: {
        strategy: 'auto',
        attempt: 1,
        attempts: [{ provider: 'Chutes' }],
      },
    });
    expect(r?.provider).toBe('Chutes');
    expect(r?.fallback).toBe(false);
  });
  it('returns undefined without metadata', () => {
    expect(parseRouting({ id: 'gen-1' })).toBeUndefined();
  });
});

describe('SseUsageAccumulator', () => {
  const data = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
  it('remembers usage and routing from separate events (last wins)', () => {
    const acc = new SseUsageAccumulator();
    acc.feed(new TextEncoder().encode(data({ message: { usage: { input_tokens: 5 } } })));
    acc.feed(
      new TextEncoder().encode(
        data({
          id: 'gen-9',
          openrouter_metadata: {
            strategy: 'direct',
            attempt: 1,
            endpoints: { available: [{ provider: 'Novita', selected: true }] },
          },
        }),
      ),
    );
    const r = acc.result();
    expect(r.usage?.inputTokens).toBe(5);
    expect(r.routing?.provider).toBe('Novita');
  });
  it('handles a JSON event split across two feed() chunks', () => {
    const acc = new SseUsageAccumulator();
    const full = data({ usage: { prompt_tokens: 7 } });
    const mid = Math.floor(full.length / 2);
    acc.feed(new TextEncoder().encode(full.slice(0, mid)));
    acc.feed(new TextEncoder().encode(full.slice(mid)));
    expect(acc.result().usage?.inputTokens).toBe(7);
  });
  it('returns empty when no usage/metadata events', () => {
    expect(new SseUsageAccumulator().result()).toEqual({});
  });
});

describe('extractFromFullText', () => {
  it('parses a non-SSE JSON body', () => {
    const r = extractFromFullText(
      JSON.stringify({ id: 'g', usage: { prompt_tokens: 3 } }),
      false,
    );
    expect(r.usage?.inputTokens).toBe(3);
  });
});
