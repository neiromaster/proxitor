import { describe, expect, test } from 'vitest';
import { ConfigError } from './application/config-schema.js';
import type { ObservationRecord, ObservationSink } from './application/observability.js';
import { createProxitor } from './composition-root.js';
import { RoutingConfigError } from './domain/index.js';

const silent = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

const GOOD = `
version: 1
providers:
  oai:
    baseUrl: https://oai.example.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: { env: OAI_KEY } }
models:
  - match: gpt-5*
    provider: oai
    modelId: gpt-5
  - match: '*'
    provider: oai
    modelId: '$MODEL'
defaultProvider: oai
`;

describe('createProxitor', () => {
  test('assembles the full stack from config text', async () => {
    // Arrange + Act
    const proxitor = await createProxitor({
      configText: GOOD,
      env: { OAI_KEY: 'test-key' },
      fetchImpl: async () => new Response('{}', { status: 200 }),
      logger: silent,
    });
    // Assert
    expect(proxitor.config.server.port).toBe(8828);
    expect(proxitor.app).toBeDefined();
    const res = await proxitor.app.request('/v1/models');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown[] }).data.length).toBeGreaterThan(0);
  });

  test('load-time activation failure rejects (D-M5a-4)', async () => {
    const text = `
version: 1
providers:
  ant:
    baseUrl: https://ant.example.com
    wireFormat: anthropic-messages
    auth: { type: bearer, credential: k }
    headers: { anthropic-version: '2023-06-01' }
    plugins: [{ 'openrouter-routing': { only: [anthropic] } }]
models:
  - match: '*'
    provider: ant
    modelId: '$MODEL'
`;
    await expect(
      createProxitor({
        configText: text,
        env: {},
        fetchImpl: async () => new Response('{}'),
        logger: silent,
      }),
    ).rejects.toThrow(RoutingConfigError);
  });

  test('missing env credential rejects at startup (D16)', async () => {
    await expect(
      createProxitor({
        configText: GOOD,
        env: {},
        fetchImpl: async () => new Response('{}'),
        logger: silent,
      }),
    ).rejects.toThrow(/OAI_KEY/);
  });

  test('broken YAML rejects with ConfigError; missing file path rejects too', async () => {
    await expect(
      createProxitor({
        configText: '{ nope',
        env: {},
        fetchImpl: async () => new Response('{}'),
        logger: silent,
      }),
    ).rejects.toThrow(ConfigError);
    await expect(
      createProxitor({
        configPath: '/nonexistent.yaml',
        env: {},
        fetchImpl: async () => new Response('{}'),
        logger: silent,
      }),
    ).rejects.toThrow(ConfigError);
  });

  test('passed-in recording sink receives record after pipeline round-trip', async () => {
    // Arrange
    const records: ObservationRecord[] = [];
    const recordingSink: ObservationSink = {
      emit(record: ObservationRecord): void {
        records.push(record);
      },
    };

    let callCount = 0;
    const fetchImpl = async (_input: string | URL | Request, _init?: RequestInit) => {
      callCount++;
      // Return a minimal OpenAI-style streaming response
      return new Response(
        `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hello!"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":6,"total_tokens":16}}

data: [DONE]

`,
        {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        },
      );
    };

    const configText = `
version: 1
providers:
  openai:
    baseUrl: https://oai.example.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: { env: OAI_KEY } }
models:
  - match: gpt-*
    provider: openai
    modelId: gpt-4
defaultProvider: openai
`;

    // Act
    const proxitor = await createProxitor({
      configText,
      env: { OAI_KEY: 'test-key' },
      fetchImpl,
      logger: silent,
      sinks: [recordingSink],
    });

    // Make a request through the pipeline using OpenAI format
    const response = await proxitor.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      }),
    });

    // Consume the stream to ensure events are processed
    const reader = response.body?.getReader();
    if (reader) {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    }

    // Debug: if we got an error, log it
    if (response.status !== 200) {
      const errorBody = await response.text();
      console.error('Unexpected response:', response.status, errorBody);
    }

    // Assert
    expect(response.status).toBe(200);
    expect(callCount).toBe(1);
    expect(records).toHaveLength(1);
    const record = records[0];
    if (!record) throw new Error('No observation record was emitted');
    expect(record.status).toBe(200);
    expect(record.model).toBe('gpt-4');
    expect(record.provider).toBe('openai');
    expect(record.requestType).toBe('main');
    expect(record.usage.present).toBe(true);
    expect(record.usage.outputTokens).toBe(6);
  });
});
