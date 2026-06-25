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
  it('routes to OpenAI when cache_read_input_tokens is present but non-numeric', () => {
    // Arrange — a relay garbles the Anthropic field to null; the OpenAI
    // cached_tokens path must still be used, not silently dropped.
    const u = parseUsage({
      usage: {
        prompt_tokens: 500,
        cache_read_input_tokens: null,
        prompt_tokens_details: { cached_tokens: 400 },
      },
    });
    // Act & Assert
    expect(u?.cacheRead).toBe(400);
    expect(u?.inputTokens).toBe(500);
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
  it('defers to attempts[] when the selected endpoint omits provider', () => {
    const r = parseRouting({
      openrouter_metadata: {
        attempt: 1,
        endpoints: { available: [{ provider: 'OpenAI' }, { selected: true }] },
        attempts: [{ provider: 'Novita' }],
      },
    });
    expect(r?.provider).toBe('Novita');
  });
  it('reads metadata nested under response (Responses-API shape)', () => {
    // Arrange — /v1/responses wraps the payload in `response`, mirroring usage.
    const r = parseRouting({
      type: 'response.completed',
      response: {
        openrouter_metadata: {
          strategy: 'direct',
          attempt: 1,
          endpoints: { available: [{ provider: 'Novita', selected: true }] },
        },
      },
    });
    // Act & Assert
    expect(r?.provider).toBe('Novita');
    expect(r?.strategy).toBe('direct');
  });
  it('falls back to attempts when the selected endpoint has an empty provider', () => {
    // Arrange — provider:'' is not a real value; defer to the attempts array.
    const r = parseRouting({
      openrouter_metadata: {
        attempt: 1,
        endpoints: { available: [{ provider: '', selected: true }] },
        attempts: [{ provider: 'Novita' }],
      },
    });
    // Act & Assert
    expect(r?.provider).toBe('Novita');
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
  it('merges events field-by-field: a delta cache_read without input_tokens keeps start usage', () => {
    // message_start seeds usage; message_delta updates cacheRead but lacks
    // input_tokens/cache_creation → must not clobber inputTokens or cacheCreate.
    const acc = new SseUsageAccumulator();
    const enc = new TextEncoder();
    acc.feed(
      enc.encode(
        data({
          message: {
            usage: {
              input_tokens: 51000,
              cache_read_input_tokens: 1000,
              cache_creation_input_tokens: 5000,
            },
          },
        }),
      ),
    );
    acc.feed(
      enc.encode(
        data({
          message: { usage: { cache_read_input_tokens: 50000, output_tokens: 15 } },
        }),
      ),
    );
    const r = acc.result();
    expect(r.usage?.cacheRead).toBe(50000);
    expect(r.usage?.cacheCreate).toBe(5000); // preserved
    expect(r.usage?.inputTokens).toBe(57000); // preserved (delta had no input_tokens)
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
  it('strips a leading UTF-8 BOM from a non-SSE JSON body', () => {
    const r = extractFromFullText(
      `﻿${JSON.stringify({ usage: { prompt_tokens: 9 } })}`,
      false,
    );
    expect(r.usage?.inputTokens).toBe(9);
  });
  it('strips a leading UTF-8 BOM before the first SSE data: line', () => {
    const sse = `﻿data: ${JSON.stringify({ usage: { prompt_tokens: 9 } })}\n\ndata: [DONE]\n`;
    expect(extractFromFullText(sse, true).usage?.inputTokens).toBe(9);
  });
});
