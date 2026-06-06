import { afterEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../helpers.js';

describe('SSE Streaming', () => {
  let env: TestEnv;

  afterEach(async () => {
    if (env) await env.cleanup();
  });

  it('passes SSE stream through', async () => {
    const events = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      'data: [DONE]',
    ];

    env = await createTestEnv({ provider: { only: 'test-provider' } }, upstream => {
      upstream.all('/*', () => {
        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            for (const event of events) {
              controller.enqueue(encoder.encode(event + '\n\n'));
            }
            controller.close();
          },
        });
        return new Response(stream, {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      });
    });

    const res = await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [], stream: true }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('x-accel-buffering')).toBe('no');

    const text = await res.text();
    for (const event of events) {
      expect(text).toContain(event);
    }
  });

  it('handles upstream with content-encoding by stripping it', async () => {
    env = await createTestEnv(undefined, upstream => {
      upstream.post('*', () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: ok\n\n'));
            controller.close();
          },
        });
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Content-Encoding': 'gzip',
          },
        });
      });
    });

    const res = await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    });

    expect(res.status).toBe(200);
    // Content-Encoding should be stripped by the proxy
    expect(res.headers.get('content-encoding')).toBeNull();
  });
});
