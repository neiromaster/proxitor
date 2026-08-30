import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
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
      emit(emittedRecord: ObservationRecord): void {
        records.push(emittedRecord);
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
    if (!reader) throw new Error('Response body has no reader');
    let done = false;
    while (!done) {
      const result = await reader.read();
      done = result.done;
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

describe('createProxitor hot-reload wiring', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    // Create a temporary directory for test config files
    tmpDir = await mkdtemp(join(tmpdir(), 'proxitor-test-'));
    configPath = join(tmpDir, 'config.yaml');
  });

  test('proxitor.reload() on tmp config file rewritten with second model → ok:true and /v1/models reflects new model', async () => {
    // Arrange - initial config with one model
    const initialConfig = `
version: 1
providers:
  oai:
    baseUrl: https://oai.example.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: sk-test }
models:
  - match: gpt-4
    provider: oai
    modelId: gpt-4
defaultProvider: oai
`;
    await writeFile(configPath, initialConfig);

    const proxitor = await createProxitor({
      configPath,
      env: {},
      fetchImpl: async () => new Response('{}', { status: 200 }),
      logger: silent,
    });

    // Verify initial model list
    const initialRes = await proxitor.app.request('/v1/models');
    const initialModels = (await initialRes.json()) as { data: Array<{ id: string }> };
    expect(initialModels.data).toHaveLength(1);
    expect(initialModels.data[0]!.id).toBe('gpt-4');

    // Act - rewrite config with a second model
    const updatedConfig = `
version: 1
providers:
  oai:
    baseUrl: https://oai.example.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: sk-test }
models:
  - match: gpt-4
    provider: oai
    modelId: gpt-4
  - match: claude-3
    provider: oai
    modelId: claude-3-opus
defaultProvider: oai
`;
    await writeFile(configPath, updatedConfig);

    // Trigger reload (will be called by watcher, but we call it directly for test)
    const reloadResult = await proxitor.reload();

    // Assert
    expect(reloadResult.ok).toBe(true);
    if (reloadResult.ok) {
      expect(reloadResult.changes).toContain('+claude-3');
    }

    // Verify /v1/models reflects new model list
    const updatedRes = await proxitor.app.request('/v1/models');
    const updatedModels = (await updatedRes.json()) as { data: Array<{ id: string }> };
    expect(updatedModels.data).toHaveLength(2);
    const modelIds = updatedModels.data.map(m => m.id);
    expect(modelIds).toContain('gpt-4');
    expect(modelIds).toContain('claude-3');
  });

  test('rewritten with invalid YAML → {ok:false} and /v1/models still lists old set (keep-last-valid)', async () => {
    // Arrange - initial config
    const initialConfig = `
version: 1
providers:
  oai:
    baseUrl: https://oai.example.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: sk-test }
models:
  - match: gpt-4
    provider: oai
    modelId: gpt-4
defaultProvider: oai
`;
    await writeFile(configPath, initialConfig);

    const proxitor = await createProxitor({
      configPath,
      env: {},
      fetchImpl: async () => new Response('{}', { status: 200 }),
      logger: silent,
    });

    // Verify initial model list
    const initialRes = await proxitor.app.request('/v1/models');
    const initialModels = (await initialRes.json()) as { data: Array<{ id: string }> };
    expect(initialModels.data).toHaveLength(1);

    // Act - rewrite config with invalid YAML
    const invalidConfig = `
version: 1
providers:
  oai:
    baseUrl: https://oai.example.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: sk-test }
models:
  - match: gpt-4
    provider: oai
    modelId: gpt-4
  this is: invalid: yaml
`;
    await writeFile(configPath, invalidConfig);

    // Trigger reload
    const reloadResult = await proxitor.reload();

    // Assert
    expect(reloadResult.ok).toBe(false);
    if (!reloadResult.ok) {
      expect(reloadResult.error).toBeDefined();
    }

    // Verify /v1/models still lists old set (keep-last-valid)
    const afterRes = await proxitor.app.request('/v1/models');
    const afterModels = (await afterRes.json()) as { data: Array<{ id: string }> };
    expect(afterModels.data).toHaveLength(1);
    expect(afterModels.data[0]!.id).toBe('gpt-4');
  });

  test('configText-sourced proxitor → reload() succeeds by re-parsing the stored text (no <memory> file read)', async () => {
    // Arrange - create proxitor from config text (no file path)
    const proxitor = await createProxitor({
      configText: `
version: 1
providers:
  oai:
    baseUrl: https://oai.example.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: sk-test }
models:
  - match: gpt-4
    provider: oai
    modelId: gpt-4
defaultProvider: oai
`,
      env: {},
      fetchImpl: async () => new Response('{}', { status: 200 }),
      logger: silent,
    });

    // Act - reload (text is immutable, so this is a no-op change, not a failure)
    const reloadResult = await proxitor.reload();

    // Assert
    expect(reloadResult.ok).toBe(true);
    if (reloadResult.ok) {
      expect(reloadResult.changes).toBe('');
    }
    // Stack still serves the same models after reload
    const res = await proxitor.app.request('/v1/models');
    expect(res.status).toBe(200);
    const models = (await res.json()) as { data: Array<{ id: string }> };
    expect(models.data).toHaveLength(1);
    expect(models.data[0]!.id).toBe('gpt-4');
  });

  test('swap preserves proxitor.watcher lifecycle (start/stop callable)', async () => {
    // Arrange
    const initialConfig = `
version: 1
providers:
  oai:
    baseUrl: https://oai.example.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: sk-test }
models:
  - match: gpt-4
    provider: oai
    modelId: gpt-4
defaultProvider: oai
`;
    await writeFile(configPath, initialConfig);

    const proxitor = await createProxitor({
      configPath,
      env: {},
      fetchImpl: async () => new Response('{}', { status: 200 }),
      logger: silent,
    });

    // Act - start watcher (idempotent)
    proxitor.watcher.start();
    proxitor.watcher.start(); // Second start should be no-op

    // Act - stop watcher (idempotent)
    proxitor.watcher.stop();
    proxitor.watcher.stop(); // Second stop should be no-op

    // Assert - no errors thrown, watcher lifecycle is preserved
    expect(proxitor.watcher).toBeDefined();
  });

  test('proxitor.config delegates to hot-reload current config', async () => {
    // Arrange
    const initialConfig = `
version: 1
providers:
  oai:
    baseUrl: https://oai.example.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: sk-test }
models:
  - match: gpt-4
    provider: oai
    modelId: gpt-4
defaultProvider: oai
`;
    await writeFile(configPath, initialConfig);

    const proxitor = await createProxitor({
      configPath,
      env: {},
      fetchImpl: async () => new Response('{}', { status: 200 }),
      logger: silent,
    });

    // Act & Assert - config should be accessible and reflect current config
    expect(proxitor.config).toBeDefined();
    expect(proxitor.config.providers).toBeDefined();
    expect(proxitor.config.models).toHaveLength(1);
    expect(proxitor.config.models[0]!.match).toBe('gpt-4');
  });

  test('proxitor.table delegates to hot-reload facade', async () => {
    // Arrange
    const initialConfig = `
version: 1
providers:
  oai:
    baseUrl: https://oai.example.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: sk-test }
models:
  - match: gpt-4
    provider: oai
    modelId: gpt-4
defaultProvider: oai
`;
    await writeFile(configPath, initialConfig);

    const proxitor = await createProxitor({
      configPath,
      env: {},
      fetchImpl: async () => new Response('{}', { status: 200 }),
      logger: silent,
    });

    // Act & Assert - table should be accessible and delegate to facade
    expect(proxitor.table).toBeDefined();
    const resolution = proxitor.table.resolve('gpt-4', '/v1/chat/completions');
    expect(resolution).toBeDefined();
    expect(resolution.provider.id).toBe('oai');
  });
});

describe('createProxitor control-plane wiring', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'proxitor-test-'));
    configPath = join(tmpDir, 'config.yaml');
  });

  test('config with controlPlane token → POST /control/reload with correct token → 200', async () => {
    // Arrange - config with control-plane token
    const configWithControlPlane = `
version: 1
providers:
  oai:
    baseUrl: https://oai.example.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: sk-test }
models:
  - match: gpt-4
    provider: oai
    modelId: gpt-4
defaultProvider: oai
controlPlane:
  token: { env: TEST_TOKEN }
`;
    await writeFile(configPath, configWithControlPlane);

    const proxitor = await createProxitor({
      configPath,
      env: { TEST_TOKEN: 'my-secret-token' },
      fetchImpl: async () => new Response('{}', { status: 200 }),
      logger: silent,
    });

    // Act - POST /control/reload with correct token
    const res = await proxitor.app.request('/control/reload', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer my-secret-token',
      },
    });

    // Assert - 200 OK
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('ok', true);
  });

  test('config with controlPlane token → POST /control/reload with wrong token → 401', async () => {
    // Arrange
    const configWithControlPlane = `
version: 1
providers:
  oai:
    baseUrl: https://oai.example.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: sk-test }
models:
  - match: gpt-4
    provider: oai
    modelId: gpt-4
defaultProvider: oai
controlPlane:
  token: { env: TEST_TOKEN }
`;
    await writeFile(configPath, configWithControlPlane);

    const proxitor = await createProxitor({
      configPath,
      env: { TEST_TOKEN: 'my-secret-token' },
      fetchImpl: async () => new Response('{}', { status: 200 }),
      logger: silent,
    });

    // Act - POST /control/reload with wrong token
    const res = await proxitor.app.request('/control/reload', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer wrong-token',
      },
    });

    // Assert - 401 Unauthorized
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string; type: string } };
    expect(body).toEqual({
      error: { message: 'unauthorized', type: 'invalid_request_error' },
    });
  });

  test('config without controlPlane → /control/reload → 404 (falls through to proxy 404)', async () => {
    // Arrange - config WITHOUT control-plane
    const configWithoutControlPlane = `
version: 1
providers:
  oai:
    baseUrl: https://oai.example.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: sk-test }
models:
  - match: gpt-4
    provider: oai
    modelId: gpt-4
defaultProvider: oai
`;
    await writeFile(configPath, configWithoutControlPlane);

    const proxitor = await createProxitor({
      configPath,
      env: {},
      fetchImpl: async () => new Response('{}', { status: 200 }),
      logger: silent,
    });

    // Act - POST /control/reload (no control-plane mounted)
    const res = await proxitor.app.request('/control/reload', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer any-token',
      },
    });

    // Assert - 404 (falls through to proxy 404)
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { message: string; type: string } };
    expect(body).toEqual({
      error: { message: "unknown path '/control/reload'", type: 'invalid_request_error' },
    });
  });

  test('missing env var for controlPlane.token at startup → createProxitor rejects (D16 fail-fast)', async () => {
    // Arrange - config with control-plane token referencing missing env var
    const configWithMissingEnv = `
version: 1
providers:
  oai:
    baseUrl: https://oai.example.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: sk-test }
models:
  - match: gpt-4
    provider: oai
    modelId: gpt-4
defaultProvider: oai
controlPlane:
  token: { env: NONEXISTENT_TOKEN }
`;
    await writeFile(configPath, configWithMissingEnv);

    // Act & Assert - createProxitor should reject
    await expect(
      createProxitor({
        configPath,
        env: {}, // NONEXISTENT_TOKEN not set
        fetchImpl: async () => new Response('{}', { status: 200 }),
        logger: silent,
      }),
    ).rejects.toThrow(/NONEXISTENT_TOKEN/);
  });

  test('GET /control/routing returns routing view without credentials', async () => {
    // Arrange
    const configWithControlPlane = `
version: 1
providers:
  oai:
    baseUrl: https://oai.example.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: sk-test }
models:
  - match: gpt-4
    provider: oai
    modelId: gpt-4
defaultProvider: oai
controlPlane:
  token: { env: TEST_TOKEN }
`;
    await writeFile(configPath, configWithControlPlane);

    const proxitor = await createProxitor({
      configPath,
      env: { TEST_TOKEN: 'my-secret-token' },
      fetchImpl: async () => new Response('{}', { status: 200 }),
      logger: silent,
    });

    // Act - GET /control/routing
    const res = await proxitor.app.request('/control/routing', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer my-secret-token',
      },
    });

    // Assert - 200 with routing view
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      providers: unknown[];
      models: unknown[];
      defaultProvider?: string;
    };
    expect(body).toHaveProperty('providers');
    expect(body).toHaveProperty('models');
    expect(body).toHaveProperty('defaultProvider', 'oai');

    // Verify no credentials in output
    const json = JSON.stringify(body);
    expect(json).not.toContain('auth');
    expect(json).not.toContain('credential');
    expect(json).not.toContain('sk-test');

    // Verify structure
    expect(body.providers).toHaveLength(1);
    expect(body.providers[0]).toEqual({
      id: 'oai',
      baseUrl: 'https://oai.example.com',
      wireFormat: 'openai-chat',
    });
    expect(body.models).toHaveLength(1);
    expect(body.models[0]).toEqual({
      match: 'gpt-4',
      provider: 'oai',
      modelId: 'gpt-4',
    });
  });

  test('reload through control plane reloads the real stack', async () => {
    // Arrange - initial config with one model
    const initialConfig = `
version: 1
providers:
  oai:
    baseUrl: https://oai.example.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: sk-test }
models:
  - match: gpt-4
    provider: oai
    modelId: gpt-4
defaultProvider: oai
controlPlane:
  token: { env: TEST_TOKEN }
`;
    await writeFile(configPath, initialConfig);

    const proxitor = await createProxitor({
      configPath,
      env: { TEST_TOKEN: 'my-secret-token' },
      fetchImpl: async () => new Response('{}', { status: 200 }),
      logger: silent,
    });

    // Verify initial state via /control/routing
    const initialRouting = await proxitor.app.request('/control/routing', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer my-secret-token',
      },
    });
    const initialBody = (await initialRouting.json()) as { models: unknown[] };
    expect(initialBody.models).toHaveLength(1);

    // Act - rewrite config with a second model
    const updatedConfig = `
version: 1
providers:
  oai:
    baseUrl: https://oai.example.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: sk-test }
models:
  - match: gpt-4
    provider: oai
    modelId: gpt-4
  - match: claude-3
    provider: oai
    modelId: claude-3-opus
defaultProvider: oai
controlPlane:
  token: { env: TEST_TOKEN }
`;
    await writeFile(configPath, updatedConfig);

    // Trigger reload via /control/reload
    const reloadRes = await proxitor.app.request('/control/reload', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer my-secret-token',
      },
    });

    // Assert - reload successful
    expect(reloadRes.status).toBe(200);
    const reloadBody = (await reloadRes.json()) as { ok: boolean };
    expect(reloadBody.ok).toBe(true);

    // Verify /control/routing reflects updated models
    const updatedRouting = await proxitor.app.request('/control/routing', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer my-secret-token',
      },
    });
    const updatedBody = (await updatedRouting.json()) as {
      models: Array<{ match: string }>;
    };
    expect(updatedBody.models).toHaveLength(2);
    const modelMatches = updatedBody.models.map((m: { match: string }) => m.match);
    expect(modelMatches).toContain('gpt-4');
    expect(modelMatches).toContain('claude-3');
  });

  test('reload with rotated token file → new token 200, old token 401 (live controlPlane token)', async () => {
    // Arrange - config whose controlPlane token is a file ref
    const tokenPath = join(tmpDir, 'control-token');
    await writeFile(tokenPath, 'token-old\n', { mode: 0o600 });
    const configWithControlPlane = `
version: 1
providers:
  oai:
    baseUrl: https://oai.example.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: sk-test }
models:
  - match: gpt-4
    provider: oai
    modelId: gpt-4
defaultProvider: oai
controlPlane:
  token: { file: ${JSON.stringify(tokenPath)} }
`;
    await writeFile(configPath, configWithControlPlane);

    const proxitor = await createProxitor({
      configPath,
      env: {},
      fetchImpl: async () => new Response('{}', { status: 200 }),
      logger: silent,
    });

    const call = (token: string) =>
      proxitor.app.request('/control/reload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

    // Sanity - old token accepted before rotation
    expect((await call('token-old')).status).toBe(200);

    // Act - rotate the token file and reload (preload re-reads the file)
    await writeFile(tokenPath, 'token-new\n');
    const reloadResult = await proxitor.reload();

    // Assert - new token accepted, old token rejected
    expect(reloadResult.ok).toBe(true);
    expect((await call('token-new')).status).toBe(200);
    expect((await call('token-old')).status).toBe(401);
  });

  test('reload that removes controlPlane → /control/* now 404', async () => {
    // Arrange - config WITH control-plane
    const configWithControlPlane = `
version: 1
providers:
  oai:
    baseUrl: https://oai.example.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: sk-test }
models:
  - match: gpt-4
    provider: oai
    modelId: gpt-4
defaultProvider: oai
controlPlane:
  token: { env: TEST_TOKEN }
`;
    await writeFile(configPath, configWithControlPlane);

    const proxitor = await createProxitor({
      configPath,
      env: { TEST_TOKEN: 'my-secret-token' },
      fetchImpl: async () => new Response('{}', { status: 200 }),
      logger: silent,
    });

    // Sanity - mounted before the reload: wrong token → 401
    const before = await proxitor.app.request('/control/reload', {
      method: 'POST',
      headers: { Authorization: 'Bearer nope' },
    });
    expect(before.status).toBe(401);

    // Act - rewrite config WITHOUT controlPlane and reload
    const configWithoutControlPlane = `
version: 1
providers:
  oai:
    baseUrl: https://oai.example.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: sk-test }
models:
  - match: gpt-4
    provider: oai
    modelId: gpt-4
defaultProvider: oai
`;
    await writeFile(configPath, configWithoutControlPlane);
    const reloadResult = await proxitor.reload();

    // Assert - /control/* behaves as unmounted (proxy-shaped 404)
    expect(reloadResult.ok).toBe(true);
    const after = await proxitor.app.request('/control/reload', {
      method: 'POST',
      headers: { Authorization: 'Bearer my-secret-token' },
    });
    expect(after.status).toBe(404);
    const body = (await after.json()) as { error: { message: string; type: string } };
    expect(body).toEqual({
      error: { message: "unknown path '/control/reload'", type: 'invalid_request_error' },
    });
  });

  test('controlPlane token change surfaces in reload changes and rotates live auth', async () => {
    // Arrange - config with literal controlPlane token
    const writeConfig = (token: string) =>
      writeFile(
        configPath,
        `
version: 1
providers:
  oai:
    baseUrl: https://oai.example.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: sk-test }
models:
  - match: gpt-4
    provider: oai
    modelId: gpt-4
defaultProvider: oai
controlPlane:
  token: ${token}
`,
      );
    await writeConfig('token-old');

    const proxitor = await createProxitor({
      configPath,
      env: {},
      fetchImpl: async () => new Response('{}', { status: 200 }),
      logger: silent,
    });

    const call = (token: string) =>
      proxitor.app.request('/control/reload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

    // Act - rotate the literal token in the config and reload
    await writeConfig('token-new');
    const reloadResult = await proxitor.reload();

    // Assert - diff names controlPlane and auth follows the new token
    expect(reloadResult.ok).toBe(true);
    if (reloadResult.ok) {
      expect(reloadResult.changes).toContain('controlPlane (changed)');
    }
    expect((await call('token-new')).status).toBe(200);
    expect((await call('token-old')).status).toBe(401);
  });
});
