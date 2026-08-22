import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ReloadResult } from '../../application/hot-reload.js';
import type {
  ObservationRecord,
  ObservationSink,
} from '../../application/observability.js';
import { createProxitor } from '../../composition-root.js';

const SILENT = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

describe('M6 lifecycle integration flow', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'proxitor-m6-'));
    configPath = join(tmpDir, 'config.yaml');
  });

  afterEach(async () => {
    // Clean up watcher if any proxitor instances were created
    // Note: watchers are stopped automatically when tests end
  });

  describe('observability through the stack', () => {
    test('non-stream OpenAI JSON response with usage → recording sink receives exactly one record with pinned fields', async () => {
      // Arrange
      const records: ObservationRecord[] = [];
      const recordingSink: ObservationSink = {
        emit(emitted: ObservationRecord): void {
          records.push(emitted);
        },
      };

      const configText = `
version: 1
providers:
  openai:
    baseUrl: https://api.openai.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: sk-test-key }
models:
  - match: gpt-*
    provider: openai
    modelId: gpt-4
defaultProvider: openai
observability:
  routerMetadata: true
  hitThreshold: 80
  sideMaxTokens: 4096
  sessionMaxEntries: 4096
  sessionTtlMs: 600000
`;

      let callCount = 0;
      const fetchImpl = async () => {
        callCount++;
        // Return a non-stream OpenAI JSON response with usage including prompt_tokens_details cached tokens
        return new Response(
          JSON.stringify({
            id: 'chatcmpl-123',
            object: 'chat.completion',
            created: 1234567890,
            model: 'gpt-4',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: 'Hello!',
                },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 6,
              total_tokens: 16,
              prompt_tokens_details: {
                cached_tokens: 8,
              },
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      };

      // Act
      const proxitor = await createProxitor({
        configText,
        env: {},
        fetchImpl,
        logger: SILENT,
        sinks: [recordingSink],
      });

      const res = await proxitor.app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });

      // Assert
      expect(res.status).toBe(200);
      expect(callCount).toBe(1);
      expect(records).toHaveLength(1);

      const record = records[0]!;
      expect(record).toEqual({
        requestId: expect.any(String),
        status: 200,
        model: 'gpt-4',
        provider: 'openai',
        physicalModel: 'gpt-4',
        sessionId: undefined,
        requestType: 'main',
        toolsCount: 0,
        usage: {
          present: true,
          inputTokens: 10,
          outputTokens: 6,
          cacheRead: 8,
          cacheCreate: 0,
        },
        outcome: { label: 'HIT', hitPct: 80, type: 'main' },
        requestBody: undefined,
      });
    });
  });

  describe('hot-reload keep-last-valid + apply', () => {
    test('rewrite config file adding a model binding → proxitor.reload() → ok:true → /v1/models includes the new id', async () => {
      // Arrange - initial config with one model
      const initialConfig = `
version: 1
providers:
  oai:
    baseUrl: https://api.openai.com
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
        logger: SILENT,
      });

      // Verify initial model list
      const initialRes = await proxitor.app.request('/v1/models');
      const initialModels = (await initialRes.json()) as { data: Array<{ id: string }> };
      expect(initialModels.data).toHaveLength(1);
      expect(initialModels.data[0]!.id).toBe('gpt-4');

      // Act - rewrite config adding a second model binding
      const updatedConfig = `
version: 1
providers:
  oai:
    baseUrl: https://api.openai.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: sk-test }
models:
  - match: gpt-4
    provider: oai
    modelId: gpt-4
  - match: claude-3-opus
    provider: oai
    modelId: claude-3-opus-20240229
defaultProvider: oai
`;
      await writeFile(configPath, updatedConfig);

      const reloadResult = await proxitor.reload();

      // Assert
      expect(reloadResult.ok).toBe(true);
      if (reloadResult.ok) {
        expect(reloadResult.changes).toContain('+claude-3-opus');
      }

      // Verify /v1/models reflects the new model
      const updatedRes = await proxitor.app.request('/v1/models');
      const updatedModels = (await updatedRes.json()) as { data: Array<{ id: string }> };
      expect(updatedModels.data).toHaveLength(2);
      const modelIds = updatedModels.data.map(m => m.id);
      expect(modelIds).toContain('gpt-4');
      expect(modelIds).toContain('claude-3-opus');
    });

    test('rewrite with broken YAML → ok:false → /v1/models unchanged (keep-last-valid)', async () => {
      // Arrange - initial config
      const initialConfig = `
version: 1
providers:
  oai:
    baseUrl: https://api.openai.com
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
        logger: SILENT,
      });

      // Verify initial model list
      const initialRes = await proxitor.app.request('/v1/models');
      const initialModels = (await initialRes.json()) as { data: Array<{ id: string }> };
      expect(initialModels.data).toHaveLength(1);

      // Act - rewrite with broken YAML
      const brokenConfig = `
version: 1
providers:
  oai:
    baseUrl: https://api.openai.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: sk-test }
models:
  - match: gpt-4
    provider: oai
    modelId: gpt-4
this is: invalid: yaml: [broken
`;
      await writeFile(configPath, brokenConfig);

      const reloadResult = await proxitor.reload();

      // Assert
      expect(reloadResult.ok).toBe(false);
      if (!reloadResult.ok) {
        expect(reloadResult.error).toBeDefined();
      }

      // Verify /v1/models unchanged (keep-last-valid)
      const afterRes = await proxitor.app.request('/v1/models');
      const afterModels = (await afterRes.json()) as { data: Array<{ id: string }> };
      expect(afterModels.data).toHaveLength(1);
      expect(afterModels.data[0]!.id).toBe('gpt-4');
    });
  });

  describe('control-plane token-gated endpoints', () => {
    test('config with controlPlane token + env → POST /control/reload (valid Bearer) → 200 {ok:true}', async () => {
      // Arrange
      const configWithControlPlane = `
version: 1
providers:
  oai:
    baseUrl: https://api.openai.com
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
        logger: SILENT,
      });

      // Act - POST /control/reload with valid Bearer token
      const res = await proxitor.app.request('/control/reload', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer my-secret-token',
        },
      });

      // Assert
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, changes: expect.any(String) });
    });

    test('POST /control/reload with wrong token → 401', async () => {
      // Arrange
      const configWithControlPlane = `
version: 1
providers:
  oai:
    baseUrl: https://api.openai.com
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
        logger: SILENT,
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
      const body = await res.json();
      expect(body).toEqual({
        error: { message: 'unauthorized', type: 'invalid_request_error' },
      });
    });

    test('GET /control/routing → 200 with pinned view (no credential keys)', async () => {
      // Arrange - config with multiple providers and models
      const configWithControlPlane = `
version: 1
providers:
  openai:
    baseUrl: https://api.openai.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: sk-openai }
  anthropic:
    baseUrl: https://api.anthropic.com
    wireFormat: anthropic-messages
    auth: { type: bearer, credential: sk-ant-key }
    headers:
      anthropic-version: '2023-06-01'
models:
  - match: gpt-*
    provider: openai
    modelId: gpt-4
  - match: claude-*
    provider: anthropic
    modelId: claude-3-5-sonnet
defaultProvider: openai
controlPlane:
  token: { env: TEST_TOKEN }
`;
      await writeFile(configPath, configWithControlPlane);

      const proxitor = await createProxitor({
        configPath,
        env: { TEST_TOKEN: 'my-secret-token' },
        fetchImpl: async () => new Response('{}', { status: 200 }),
        logger: SILENT,
      });

      // Act - GET /control/routing
      const res = await proxitor.app.request('/control/routing', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer my-secret-token',
        },
      });

      // Assert - 200 with pinned routing view
      expect(res.status).toBe(200);
      const body = await res.json();

      // Pinned view shape (no credential keys)
      expect(body).toEqual({
        providers: [
          {
            id: 'openai',
            baseUrl: 'https://api.openai.com',
            wireFormat: 'openai-chat',
          },
          {
            id: 'anthropic',
            baseUrl: 'https://api.anthropic.com',
            wireFormat: 'anthropic-messages',
          },
        ],
        models: [
          { match: 'gpt-*', provider: 'openai', modelId: 'gpt-4' },
          { match: 'claude-*', provider: 'anthropic', modelId: 'claude-3-5-sonnet' },
        ],
        defaultProvider: 'openai',
      });

      // Verify no credentials leaked
      const json = JSON.stringify(body);
      expect(json).not.toContain('auth');
      expect(json).not.toContain('credential');
      expect(json).not.toContain('sk-openai');
      expect(json).not.toContain('sk-ant-key');
    });

    test('proxitor without controlPlane → /control/reload → 404', async () => {
      // Arrange - config WITHOUT control-plane
      const configWithoutControlPlane = `
version: 1
providers:
  oai:
    baseUrl: https://api.openai.com
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
        logger: SILENT,
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
      const body = await res.json();
      expect(body).toEqual({
        error: {
          message: "unknown path '/control/reload'",
          type: 'invalid_request_error',
        },
      });
    });
  });

  describe('watcher smoke', () => {
    test('createConfigWatcher with tiny pollIntervalMs + real tmp file + mtime-forced change → reload called (bounded vi.waitFor)', async () => {
      // Arrange - create a real config file
      const configText = `
version: 1
providers:
  oai:
    baseUrl: https://api.openai.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: sk-test }
models:
  - match: gpt-4
    provider: oai
    modelId: gpt-4
defaultProvider: oai
`;
      await writeFile(configPath, configText);

      const reloadSpy = vi.fn<() => Promise<ReloadResult>>(() =>
        Promise.resolve({ ok: true, changes: 'test' }),
      );
      const logger = { ...SILENT, info: vi.fn(), warn: vi.fn() };

      const watcher = await import('../../adapters/config-watch.js').then(m =>
        m.createConfigWatcher({
          path: configPath,
          reload: reloadSpy,
          logger,
          pollIntervalMs: 50, // tiny poll interval for test
        }),
      );

      // Act - start the watcher
      watcher.start();

      // Force an mtime change by rewriting the file
      await new Promise(resolve => setTimeout(resolve, 60)); // wait for at least one poll
      await writeFile(configPath, configText + '\n# updated'); // append a comment

      // Wait for reload to be called (bounded wait with vi.waitFor)
      await vi.waitFor(
        () => {
          expect(reloadSpy).toHaveBeenCalled();
        },
        { timeout: 500 },
      );

      // Assert - reload was called at least once
      expect(reloadSpy).toHaveBeenCalled();

      // Cleanup
      watcher.stop();
    });
  });
});
