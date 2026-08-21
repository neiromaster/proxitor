import { describe, expect, test } from 'vitest';
import { ConfigError } from './application/config-schema.js';
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
});
