import { describe, expect, it, vi } from 'vitest';
import { logger } from '../../src/logger.js';
import { createTestEnv } from '../helpers.js';

describe('Cache usage logging', () => {
  it('passes through JSON responses with cache metadata', async () => {
    const { proxyUrl, cleanup } = await createTestEnv(undefined, app => {
      app.post('/chat/completions', async c => {
        return c.json({
          id: 'chatcmpl-123',
          choices: [],
          usage: {
            prompt_tokens: 200_000,
            completion_tokens: 500,
            cache_read_input_tokens: 200_000,
            cache_creation_input_tokens: 0,
          },
        });
      });
    });

    const res = await fetch(`${proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-test', messages: [] }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.usage.cache_read_input_tokens).toBe(200_000);

    await cleanup();
  });

  it('logs cache read tokens from successful JSON responses', async () => {
    const infoSpy = vi.spyOn(logger, 'info');

    const { proxyUrl, cleanup } = await createTestEnv(undefined, app => {
      app.post('/chat/completions', async c => {
        return c.json({
          id: 'chatcmpl-456',
          choices: [],
          usage: {
            prompt_tokens: 150_000,
            completion_tokens: 300,
            cache_read_input_tokens: 50_000,
            cache_creation_input_tokens: 100_000,
          },
        });
      });
    });

    const res = await fetch(`${proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-test', messages: [] }),
    });

    expect(res.status).toBe(200);
    // Consume the body to ensure the TransformStream flush completes
    await res.json();

    const cacheLogs = infoSpy.mock.calls
      .map((args: string[]) =>
        args.find(a => typeof a === 'string' && a.includes('Cache')),
      )
      .filter(Boolean);

    expect(cacheLogs.length).toBeGreaterThanOrEqual(1);
    expect(cacheLogs[0]).toMatch(/read: 50000/);
    expect(cacheLogs[0]).toMatch(/write: 100000/);

    infoSpy.mockRestore();
    await cleanup();
  });

  it('logs zero cached tokens when usage exists but cache fields are absent', async () => {
    const infoSpy = vi.spyOn(logger, 'info');

    const { proxyUrl, cleanup } = await createTestEnv(undefined, app => {
      app.post('/chat/completions', async c => {
        return c.json({
          id: 'chatcmpl-789',
          choices: [],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
          },
        });
      });
    });

    const res = await fetch(`${proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-test', messages: [] }),
    });

    expect(res.status).toBe(200);
    // Consume the body to ensure the TransformStream flush completes
    await res.json();

    const cacheLogs = infoSpy.mock.calls
      .map((args: string[]) =>
        args.find(a => typeof a === 'string' && a.includes('Cache')),
      )
      .filter(Boolean);

    expect(cacheLogs.length).toBeGreaterThanOrEqual(1);
    expect(cacheLogs[0]).toMatch(/no cached tokens/);

    infoSpy.mockRestore();
    await cleanup();
  });

  it('logs cache tokens from Anthropic SSE streaming responses', async () => {
    const infoSpy = vi.spyOn(logger, 'info');

    const sseEvents = [
      'event: message_start\n' +
        'data: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","content":[],"model":"claude-sonnet-4-6","usage":{"input_tokens":2679,"cache_creation_input_tokens":25000,"cache_read_input_tokens":50000,"output_tokens":3}}}',
      'event: content_block_delta\n' +
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
      'event: message_delta\n' +
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":15}}',
      'event: message_stop\n' + 'data: {"type":"message_stop"}',
    ];

    const { proxyUrl, cleanup } = await createTestEnv(undefined, app => {
      app.post('/chat/completions', async _c => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            for (const event of sseEvents) {
              controller.enqueue(encoder.encode(`${event}\n\n`));
            }
            controller.close();
          },
        });
        return new Response(stream, {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      });
    });

    const res = await fetch(`${proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-test', messages: [], stream: true }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    // Consume the full stream to ensure TransformStream flush completes
    const text = await res.text();
    expect(text).toContain('message_start');

    const cacheLogs = infoSpy.mock.calls
      .map((args: string[]) =>
        args.find(a => typeof a === 'string' && a.includes('Cache')),
      )
      .filter(Boolean);

    expect(cacheLogs.length).toBeGreaterThanOrEqual(1);
    expect(cacheLogs[0]).toMatch(/read: 50000/);
    expect(cacheLogs[0]).toMatch(/write: 25000/);

    infoSpy.mockRestore();
    await cleanup();
  });

  it('logs cache tokens from OpenAI streaming final chunk', async () => {
    const infoSpy = vi.spyOn(logger, 'info');

    const sseChunks = [
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant"}}]}',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hi"}}]}',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":100,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":50000}}}',
      'data: [DONE]',
    ];

    const { proxyUrl, cleanup } = await createTestEnv(undefined, app => {
      app.post('/chat/completions', async _c => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            for (const chunk of sseChunks) {
              controller.enqueue(encoder.encode(`${chunk}\n\n`));
            }
            controller.close();
          },
        });
        return new Response(stream, {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      });
    });

    const res = await fetch(`${proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', messages: [], stream: true }),
    });

    expect(res.status).toBe(200);

    // Consume the full stream
    const text = await res.text();
    expect(text).toContain('[DONE]');

    const cacheLogs = infoSpy.mock.calls
      .map((args: string[]) =>
        args.find(a => typeof a === 'string' && a.includes('Cache')),
      )
      .filter(Boolean);

    expect(cacheLogs.length).toBeGreaterThanOrEqual(1);
    expect(cacheLogs[0]).toMatch(/read: 50000/);

    infoSpy.mockRestore();
    await cleanup();
  });
});
