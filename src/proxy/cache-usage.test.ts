import { describe, expect, it } from 'vitest';
import { extractCacheUsage, extractCacheUsageFromSSE } from './cache-logging.js';

describe('extractCacheUsage', () => {
  it('extracts both cache read and cache creation', () => {
    const body = JSON.stringify({
      usage: {
        input_tokens: 200000,
        prompt_tokens: 200000,
        completion_tokens: 500,
        cache_creation_input_tokens: 200000,
        cache_read_input_tokens: 0,
      },
    });
    // input_tokens (200k) + cacheCreate (200k) + cacheRead (0) = 400k total
    expect(extractCacheUsage(body)).toEqual({
      cacheRead: 0,
      cacheCreate: 200000,
      inputTokens: 400000,
    });
  });

  it('extracts cache read when present', () => {
    const body = JSON.stringify({
      usage: {
        input_tokens: 100,
        prompt_tokens: 100,
        cache_read_input_tokens: 50000,
      },
    });
    // input_tokens (100) + cacheRead (50k) + cacheCreate (0) = 50100 total
    expect(extractCacheUsage(body)).toEqual({
      cacheRead: 50000,
      cacheCreate: 0,
      inputTokens: 50100,
    });
  });

  it('returns undefined when usage is missing', () => {
    expect(extractCacheUsage(JSON.stringify({ id: 'chatcmpl-123' }))).toBeUndefined();
  });

  it('returns undefined for non-JSON body', () => {
    expect(extractCacheUsage('plain text')).toBeUndefined();
  });

  it('returns zero for both when cache fields are absent', () => {
    const body = JSON.stringify({
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });
    // No Anthropic input_tokens, so inputTokens = prompt_tokens (OpenAI total)
    expect(extractCacheUsage(body)).toEqual({
      cacheRead: 0,
      cacheCreate: 0,
      inputTokens: 100,
    });
  });

  // OpenAI / OpenRouter format
  it('extracts cached_tokens from prompt_tokens_details', () => {
    const body = JSON.stringify({
      usage: {
        prompt_tokens: 2006,
        completion_tokens: 300,
        prompt_tokens_details: {
          cached_tokens: 1920,
        },
      },
    });
    // OpenAI: prompt_tokens already includes cached, so inputTokens = prompt_tokens
    expect(extractCacheUsage(body)).toEqual({
      cacheRead: 1920,
      cacheCreate: 0,
      inputTokens: 2006,
    });
  });

  it('extracts cache_write_tokens from prompt_tokens_details', () => {
    const body = JSON.stringify({
      usage: {
        prompt_tokens: 10339,
        completion_tokens: 60,
        prompt_tokens_details: {
          cached_tokens: 10318,
          cache_write_tokens: 21,
        },
      },
    });
    expect(extractCacheUsage(body)).toEqual({
      cacheRead: 10318,
      cacheCreate: 21,
      inputTokens: 10339,
    });
  });

  it('prefers non-zero values when both Anthropic and OpenAI formats are present', () => {
    const body = JSON.stringify({
      usage: {
        input_tokens: 50000,
        prompt_tokens: 2000,
        cache_read_input_tokens: 50000,
        cache_creation_input_tokens: 0,
        prompt_tokens_details: {
          cached_tokens: 10318,
        },
      },
    });
    // Anthropic wins: inputTokens = 50000 + 50000 + 0 = 100000
    expect(extractCacheUsage(body)).toEqual({
      cacheRead: 50000,
      cacheCreate: 0,
      inputTokens: 100000,
    });
  });

  it('returns zero when prompt_tokens_details has zero cached_tokens', () => {
    const body = JSON.stringify({
      usage: {
        prompt_tokens: 100,
        prompt_tokens_details: {
          cached_tokens: 0,
        },
      },
    });
    expect(extractCacheUsage(body)).toEqual({
      cacheRead: 0,
      cacheCreate: 0,
      inputTokens: 100,
    });
  });

  it('prefers input_tokens over prompt_tokens for Anthropic responses', () => {
    const body = JSON.stringify({
      usage: {
        input_tokens: 2679,
        prompt_tokens: 2000,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 1500,
      },
    });
    // inputTokens = 2679 + 1000 + 1500 = 5179
    expect(extractCacheUsage(body)).toEqual({
      cacheRead: 1000,
      cacheCreate: 1500,
      inputTokens: 5179,
    });
  });

  it('uses prompt_tokens as fallback for inputTokens', () => {
    const body = JSON.stringify({
      usage: {
        prompt_tokens: 5000,
        completion_tokens: 100,
      },
    });
    expect(extractCacheUsage(body)).toEqual({
      cacheRead: 0,
      cacheCreate: 0,
      inputTokens: 5000,
    });
  });
});

describe('extractCacheUsageFromSSE', () => {
  it('extracts cache usage from Anthropic message_start event', () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","content":[],"model":"claude-sonnet-4-6","usage":{"input_tokens":2679,"cache_creation_input_tokens":25000,"cache_read_input_tokens":50000,"output_tokens":3}}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
    ].join('\n');

    // inputTokens = 2679 + 50000 + 25000 = 77679
    const usage = extractCacheUsageFromSSE(sse);
    expect(usage).toEqual({
      cacheRead: 50000,
      cacheCreate: 25000,
      inputTokens: 77679,
    });
  });

  it('extracts cache usage from OpenAI streaming final chunk', () => {
    const sse = [
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant"}}]}',
      '',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":100,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":50000}}}',
      '',
      'data: [DONE]',
    ].join('\n');

    const usage = extractCacheUsageFromSSE(sse);
    expect(usage).toEqual({
      cacheRead: 50000,
      cacheCreate: 0,
      inputTokens: 100,
    });
  });

  it('extracts cache_write_tokens from OpenRouter streaming', () => {
    const sse = [
      'data: {"id":"gen-123","choices":[],"usage":{"prompt_tokens":10339,"completion_tokens":60,"prompt_tokens_details":{"cached_tokens":10318,"cache_write_tokens":21}}}',
      '',
      'data: [DONE]',
    ].join('\n');

    const usage = extractCacheUsageFromSSE(sse);
    expect(usage).toEqual({
      cacheRead: 10318,
      cacheCreate: 21,
      inputTokens: 10339,
    });
  });

  it('takes last non-zero value across multiple events', () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":51000,"cache_read_input_tokens":1000,"cache_creation_input_tokens":5000,"output_tokens":1}}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"cache_read_input_tokens":50000,"output_tokens":15}}',
      '',
    ].join('\n');

    // First event: cacheRead=1000, cacheCreate=5000, inputTokens=51000+1000+5000=57000
    // Second event: cacheRead updated to 50000, cacheCreate stays 5000, inputTokens recalculated
    // from second event's fields: input_tokens not present so inputTokens not updated → stays 57000
    const usage = extractCacheUsageFromSSE(sse);
    expect(usage).toEqual({
      cacheRead: 50000,
      cacheCreate: 5000,
      inputTokens: 57000,
    });
  });

  it('returns undefined for SSE with no cache fields', () => {
    const sse = [
      'data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"hi"}}]}',
      '',
      'data: [DONE]',
    ].join('\n');

    expect(extractCacheUsageFromSSE(sse)).toBeUndefined();
  });

  it('returns undefined for empty SSE stream', () => {
    expect(extractCacheUsageFromSSE('')).toBeUndefined();
  });

  it('skips non-JSON data lines gracefully', () => {
    const sse = [
      'data: not-json',
      '',
      'data: {"usage":{"input_tokens":50000,"cache_read_input_tokens":50000,"cache_creation_input_tokens":0}}',
      '',
      'data: [DONE]',
    ].join('\n');

    // inputTokens = 50000 + 50000 + 0 = 100000
    const usage = extractCacheUsageFromSSE(sse);
    expect(usage).toEqual({
      cacheRead: 50000,
      cacheCreate: 0,
      inputTokens: 100000,
    });
  });

  it('handles Anthropic message_delta with cumulative usage', () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":100,"cache_creation_input_tokens":200000,"cache_read_input_tokens":0,"output_tokens":1}}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":15}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
    ].join('\n');

    // inputTokens = 100 + 0 + 200000 = 200100
    const usage = extractCacheUsageFromSSE(sse);
    expect(usage).toEqual({
      cacheRead: 0,
      cacheCreate: 200000,
      inputTokens: 200100,
    });
  });

  // --- Responses API SSE (response wrapper) ---

  it('extracts cached_tokens from Responses API response.completed event', () => {
    const sse = [
      'data: {"type":"response.created","response":{"id":"gen-123","status":"in_progress","usage":null}}',
      '',
      'data: {"type":"response.completed","response":{"id":"gen-123","status":"completed","usage":{"input_tokens":1209,"input_tokens_details":{"cached_tokens":1088},"output_tokens":10,"total_tokens":1219}}}',
      '',
      'data: [DONE]',
    ].join('\n');

    const usage = extractCacheUsageFromSSE(sse);
    expect(usage).toEqual({
      cacheRead: 1088,
      cacheCreate: 0,
      inputTokens: 1209,
    });
  });

  it('returns undefined when Responses API has zero cached tokens', () => {
    const sse = [
      'data: {"type":"response.incomplete","response":{"id":"gen-123","status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"usage":{"input_tokens":7,"input_tokens_details":{"cached_tokens":0},"output_tokens":10}}}',
      '',
      'data: [DONE]',
    ].join('\n');

    // No non-zero cache tokens → undefined (nothing to log)
    expect(extractCacheUsageFromSSE(sse)).toBeUndefined();
  });

  it('returns undefined when Responses API SSE has no cached tokens', () => {
    const sse = [
      'data: {"type":"response.completed","response":{"id":"gen-456","status":"completed","usage":{"input_tokens":1216,"input_tokens_details":{"cached_tokens":0},"output_tokens":50}}}',
      '',
      'data: [DONE]',
    ].join('\n');

    // cached_tokens is 0 → nothing to log
    expect(extractCacheUsageFromSSE(sse)).toBeUndefined();
  });

  it('extracts from Responses API SSE with both cached and write tokens', () => {
    const sse = [
      'data: {"type":"response.completed","response":{"id":"gen-456","status":"completed","usage":{"input_tokens":10339,"input_tokens_details":{"cached_tokens":10318,"cache_write_tokens":21},"output_tokens":60}}}',
      '',
      'data: [DONE]',
    ].join('\n');

    const usage = extractCacheUsageFromSSE(sse);
    expect(usage).toEqual({
      cacheRead: 10318,
      cacheCreate: 21,
      inputTokens: 10339,
    });
  });

  it('uses response wrapper when message wrapper is absent', () => {
    const sse = [
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":1209,"input_tokens_details":{"cached_tokens":1088},"output_tokens":10}}}',
      '',
      'data: [DONE]',
    ].join('\n');

    const usage = extractCacheUsageFromSSE(sse);
    expect(usage).toEqual({
      cacheRead: 1088,
      cacheCreate: 0,
      inputTokens: 1209,
    });
  });

  it('handles Responses API SSE with null usage in early events', () => {
    const sse = [
      'data: {"type":"response.created","response":{"id":"gen-789","usage":null}}',
      '',
      'data: {"type":"response.in_progress","response":{"id":"gen-789","usage":null}}',
      '',
      'data: {"type":"response.output_item.added","output_index":0}',
      '',
      'data: {"type":"response.completed","response":{"id":"gen-789","usage":{"input_tokens":1209,"input_tokens_details":{"cached_tokens":1088},"output_tokens":10}}}',
      '',
      'data: [DONE]',
    ].join('\n');

    const usage = extractCacheUsageFromSSE(sse);
    expect(usage).toEqual({
      cacheRead: 1088,
      cacheCreate: 0,
      inputTokens: 1209,
    });
  });
});

// --- Responses API non-stream (extractCacheUsage) ---

describe('extractCacheUsage — Responses API', () => {
  it('extracts from Responses API with input_tokens_details', () => {
    const body = JSON.stringify({
      id: 'gen-123',
      object: 'response',
      status: 'completed',
      usage: {
        input_tokens: 1209,
        input_tokens_details: { cached_tokens: 1088 },
        output_tokens: 10,
        total_tokens: 1219,
      },
    });
    expect(extractCacheUsage(body)).toEqual({
      cacheRead: 1088,
      cacheCreate: 0,
      inputTokens: 1209,
    });
  });

  it('extracts from Responses API with zero cached_tokens', () => {
    const body = JSON.stringify({
      id: 'gen-456',
      object: 'response',
      status: 'completed',
      usage: {
        input_tokens: 1216,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 50,
      },
    });
    expect(extractCacheUsage(body)).toEqual({
      cacheRead: 0,
      cacheCreate: 0,
      inputTokens: 1216,
    });
  });

  it('extracts from Responses API with cache_write_tokens in input_tokens_details', () => {
    const body = JSON.stringify({
      id: 'gen-789',
      object: 'response',
      status: 'completed',
      usage: {
        input_tokens: 10339,
        input_tokens_details: { cached_tokens: 10318, cache_write_tokens: 21 },
        output_tokens: 60,
      },
    });
    expect(extractCacheUsage(body)).toEqual({
      cacheRead: 10318,
      cacheCreate: 21,
      inputTokens: 10339,
    });
  });
});
