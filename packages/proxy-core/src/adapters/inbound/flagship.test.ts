import { describe, expect, test } from 'vitest';
import { createTestEnv } from './test-env.js';

// SSE fixtures copied verbatim from ../application/proxy-pipeline-upstream.test.ts
// They are the decoder-verified shapes (do not invent new ones).
const OAI_SSE = [
  'data: {"id":"c","model":"gpt-5-real","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}\n\n',
  'data: {"id":"c","model":"gpt-5-real","choices":[{"index":0,"delta":{"content":"Hi"}}]}\n\n',
  'data: {"id":"c","model":"gpt-5-real","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
  'data: [DONE]\n\n',
];

// ANTHROPIC_SSE: decoder-verified anthropic streaming events
// Based on src/formats/__fixtures__/anthropic-stream-full.sse.txt
const ANTHROPIC_SSE = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-1","type":"message","role":"assistant","model":"claude-sonnet-4-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":3,"output_tokens":2}}}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"stop","stop_sequence":null},"usage":{"output_tokens":2}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
];

/** Upstream stub: a real streaming Response from string chunks. */
const sseResponse = (chunks: readonly string[]): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );

const OPENAI_CONFIG = `
version: 1
providers:
  openai:
    baseUrl: https://api.openai.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: { env: OAI_KEY } }
models:
  - match: gpt-5*
    provider: openai
    modelId: gpt-5
  - match: '*'
    provider: openai
    modelId: '$MODEL'
defaultProvider: openai
`;

const ANTHROPIC_CONFIG = `
version: 1
providers:
  anthropic:
    baseUrl: https://api.anthropic.com
    wireFormat: anthropic-messages
    auth: { type: x-api-key, credential: { env: ANTHROPIC_KEY } }
    headers: { anthropic-version: '2023-06-01' }
models:
  - match: claude-*
    provider: anthropic
    modelId: claude-sonnet-4-5
defaultProvider: anthropic
`;

describe('flagship scenario 1 — Claude Code (anthropic client) → OpenAI provider', () => {
  test('translates request anthropic→openai and streams the openai SSE back as anthropic SSE', async () => {
    // Arrange
    const env = await createTestEnv({
      configText: OPENAI_CONFIG,
      env: { OAI_KEY: 'test-key' },
      upstream: () => sseResponse(OAI_SSE),
    });
    // Act
    const res = await env.app.request('/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5',
        max_tokens: 64,
        stream: true,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });
    const text = await res.text();
    // Assert — wire side
    expect(env.calls).toHaveLength(1);
    expect(env.calls[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(env.calls[0]?.headers.authorization).toBe('Bearer test-key');
    expect(JSON.parse(env.calls[0]?.body ?? '{}').model).toBe('gpt-5');
    // Assert — client side (anthropic SSE translation)
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(text).toContain('message_start');
    expect(text).toContain('content_block_delta');
  });
});

describe('flagship scenario 2 — open code (openai client) → Anthropic provider', () => {
  test('translates request openai→anthropic and streams anthropic SSE back as openai chunks', async () => {
    // Arrange
    const env = await createTestEnv({
      configText: ANTHROPIC_CONFIG,
      env: { ANTHROPIC_KEY: 'test-key' },
      upstream: () => sseResponse(ANTHROPIC_SSE),
    });
    // Act
    const res = await env.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 64,
        stream: true,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });
    const text = await res.text();
    // Assert — wire side
    expect(env.calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(env.calls[0]?.headers['x-api-key']).toBe('test-key');
    expect(env.calls[0]?.headers['anthropic-version']).toBe('2023-06-01');
    const sent = JSON.parse(env.calls[0]?.body ?? '{}');
    expect(sent.model).toBe('claude-sonnet-4-5');
    expect(sent.max_tokens).toEqual(expect.any(Number));
    // Assert — client side (openai SSE translation)
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(text).toContain('chat.completion.chunk');
    expect(text).toContain('[DONE]');
  });
});

describe('gateway surfaces', () => {
  test('GET /v1/models lists bindings as openai model objects', async () => {
    // Arrange
    const env = await createTestEnv({
      configText: OPENAI_CONFIG,
      env: { OAI_KEY: 'k' },
      upstream: () => new Response('{}'),
    });
    // Act
    const res = await env.app.request('/v1/models');
    const body = (await res.json()) as { object: string; data: Array<{ id: string }> };
    // Assert
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(body.object).toBe('list');
    // The /v1/models endpoint returns the match patterns from config
    expect(body.data.map(m => m.id)).toEqual(expect.arrayContaining(['gpt-5*', '*']));
  });
  test('model-less POST /v1/embeddings passes bytes through verbatim', async () => {
    // Arrange
    const env = await createTestEnv({
      configText: OPENAI_CONFIG,
      env: { OAI_KEY: 'k' },
      upstream: () =>
        new Response('{"data":[1]}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    const body = '{"model":"text-embedding-3-small","input":"x"}';
    // Act
    const res = await env.app.request('/v1/embeddings', { method: 'POST', body });
    // Assert
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"data":[1]}');
    expect(env.calls[0]?.body).toBe(body);
    expect(env.calls[0]?.url).toBe('https://api.openai.com/v1/embeddings');
  });
  test('real-listen smoke: serve() on an ephemeral port answers /v1/models, then shuts down', async () => {
    // Arrange
    const env = await createTestEnv({
      configText: OPENAI_CONFIG,
      env: { OAI_KEY: 'k' },
      upstream: () => new Response('{}'),
    });
    const { serve } = await import('@hono/node-server');
    const server = serve({ fetch: env.app.fetch, port: 0 }, async () => {
      // Act
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/v1/models`);
        expect(res.status).toBe(200);
      } finally {
        server.close();
      }
    });
    await new Promise(resolve => setTimeout(resolve, 500));
  });
});
