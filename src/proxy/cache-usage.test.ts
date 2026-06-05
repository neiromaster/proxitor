import { describe, expect, it } from 'vitest';
import { extractCacheUsage, extractCacheUsageFromSSE } from './cache-logging.js';

describe('extractCacheUsage', () => {
  it('extracts both cache read and cache creation', () => {
    const body = JSON.stringify({
      usage: {
        prompt_tokens: 200000,
        completion_tokens: 500,
        cache_creation_input_tokens: 200000,
        cache_read_input_tokens: 0,
      },
    });
    expect(extractCacheUsage(body)).toEqual({
      cacheRead: 0,
      cacheCreate: 200000,
    });
  });

  it('extracts cache read when present', () => {
    const body = JSON.stringify({
      usage: {
        prompt_tokens: 100,
        cache_read_input_tokens: 50000,
      },
    });
    expect(extractCacheUsage(body)).toEqual({
      cacheRead: 50000,
      cacheCreate: 0,
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
    expect(extractCacheUsage(body)).toEqual({
      cacheRead: 0,
      cacheCreate: 0,
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
    expect(extractCacheUsage(body)).toEqual({
      cacheRead: 1920,
      cacheCreate: 0,
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
    });
  });

  it('prefers non-zero values when both Anthropic and OpenAI formats are present', () => {
    const body = JSON.stringify({
      usage: {
        prompt_tokens: 2000,
        cache_read_input_tokens: 50000,
        cache_creation_input_tokens: 0,
        prompt_tokens_details: {
          cached_tokens: 10318,
        },
      },
    });
    expect(extractCacheUsage(body)).toEqual({
      cacheRead: 50000,
      cacheCreate: 0,
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

    const usage = extractCacheUsageFromSSE(sse);
    expect(usage).toEqual({
      cacheRead: 50000,
      cacheCreate: 25000,
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
    });
  });

  it('takes last non-zero value across multiple events', () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"cache_read_input_tokens":1000,"cache_creation_input_tokens":5000,"output_tokens":1}}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"cache_read_input_tokens":50000,"output_tokens":15}}',
      '',
    ].join('\n');

    const usage = extractCacheUsageFromSSE(sse);
    expect(usage).toEqual({
      cacheRead: 50000,
      cacheCreate: 5000,
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
      'data: {"usage":{"cache_read_input_tokens":50000,"cache_creation_input_tokens":0}}',
      '',
      'data: [DONE]',
    ].join('\n');

    const usage = extractCacheUsageFromSSE(sse);
    expect(usage).toEqual({
      cacheRead: 50000,
      cacheCreate: 0,
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

    // cache_read_input_tokens was 0 in message_start, message_delta doesn't have cache fields
    // so we keep the creation value from message_start
    const usage = extractCacheUsageFromSSE(sse);
    expect(usage).toEqual({
      cacheRead: 0,
      cacheCreate: 200000,
    });
  });
});
