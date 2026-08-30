import type { ProxyPlugin } from '@proxitor/plugin-api';
import { describe, expect, it } from 'vitest';
import type { ProviderConfig } from '../domain/index.js';
import { createRoutingTable } from '../domain/index.js';
import { createPluginManager } from './plugin-manager.js';
import { createPipeline, type PipelineDeps } from './proxy-pipeline.js';
import type { UpstreamRequest, UpstreamResponse } from './upstream-fetch.js';

const OPENAI_PROVIDER: ProviderConfig = {
  id: 'oai',
  baseUrl: 'https://oai.example.com',
  wireFormat: 'openai-chat',
  auth: { type: 'bearer', credential: { env: 'OAI_KEY' } },
};

const logger = {
  infos: [] as string[],
  warns: [] as string[],
  errors: [] as string[],
  debugs: [] as string[],
  info(message: string) {
    this.infos.push(message);
  },
  warn(message: string) {
    this.warns.push(message);
  },
  error(message: string) {
    this.errors.push(message);
  },
  debug(message: string) {
    this.debugs.push(message);
  },
};

function makeDeps(withDefault: boolean, fetchPort?: PipelineDeps['fetch']): PipelineDeps {
  const throwingFetch: PipelineDeps['fetch'] = {
    fetch: async () => {
      throw new Error('upstream must not be called in this test');
    },
  };
  return {
    table: createRoutingTable({
      providers: { oai: OPENAI_PROVIDER },
      models: [{ match: 'gpt-*', provider: 'oai', modelId: 'gpt-5-real' }],
      defaultProvider: withDefault ? 'oai' : undefined,
    }),
    manager: createPluginManager({ plugins: new Map<string, ProxyPlugin>(), logger }),
    fetch: fetchPort ?? throwingFetch,
    credentials: { resolve: () => 'resolved-secret' },
    logger,
    clock: { now: () => 0 },
    random: { uuid: () => 'req-1' },
  };
}

async function readBody(body: AsyncIterable<string>): Promise<string> {
  let text = '';
  for await (const chunk of body) {
    text += chunk;
  }
  return text;
}

describe('handle — GET /v1/models (D10)', () => {
  it('synthesizes the model list from the routing table', async () => {
    // Arrange
    const pipeline = createPipeline(makeDeps(false));
    // Act
    const response = await pipeline.handle({
      path: '/v1/models',
      method: 'GET',
      headers: {},
      body: '',
    });
    // Assert
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/json');
    expect(JSON.parse(await readBody(response.body))).toEqual({
      object: 'list',
      data: [{ id: 'gpt-*', object: 'model', owned_by: 'proxitor' }],
    });
  });

  it('rejects non-GET /v1/models with a 405 in the openai shape', async () => {
    // Arrange
    const pipeline = createPipeline(makeDeps(false));
    // Act
    const response = await pipeline.handle({
      path: '/v1/models',
      method: 'POST',
      headers: {},
      body: '{}',
    });
    // Assert
    expect(response.status).toBe(405);
    expect(JSON.parse(await readBody(response.body)).error.type).toBe(
      'invalid_request_error',
    );
  });
});

describe('handle — model-less raw passthrough (D12)', () => {
  it('passes the raw body to baseUrl + path on defaultProvider, answer untranslated', async () => {
    // Arrange
    const calls: UpstreamRequest[] = [];
    const deps = makeDeps(true, {
      fetch: async (request: UpstreamRequest): Promise<UpstreamResponse> => {
        calls.push(request);
        return {
          status: 201,
          headers: { 'content-type': 'application/x-embedding' },
          body: (async function* (): AsyncGenerator<string> {
            yield 'raw-';
            yield 'bytes';
          })(),
        };
      },
    });
    const pipeline = createPipeline(deps);
    const rawBody = JSON.stringify({ model: 'text-embedding-3-small', input: 'hi' });
    // Act
    const response = await pipeline.handle({
      path: '/v1/embeddings',
      method: 'POST',
      headers: {},
      body: rawBody,
    });
    // Assert
    expect(calls.length).toBe(1);
    const call = calls[0];
    if (call === undefined) throw new Error('no upstream call');
    expect(call.url).toBe('https://oai.example.com/v1/embeddings');
    expect(call.body).toBe(rawBody); // raw bytes, no codec round-trip
    expect(call.headers.authorization).toBe('Bearer resolved-secret');
    expect(response.status).toBe(201);
    expect(response.headers['content-type']).toBe('application/x-embedding');
    expect(await readBody(response.body)).toBe('raw-bytes');
  });

  it('returns a 501 in the openai shape when no defaultProvider is configured', async () => {
    // Arrange — a fetch port that must never be called
    let fetchCalls = 0;
    const deps = makeDeps(false, {
      fetch: async () => {
        fetchCalls += 1;
        throw new Error('must not be called');
      },
    });
    const pipeline = createPipeline(deps);
    // Act
    const response = await pipeline.handle({
      path: '/v1/embeddings',
      method: 'POST',
      headers: {},
      body: '{}',
    });
    // Assert
    expect(fetchCalls).toBe(0);
    expect(response.status).toBe(501);
    expect(JSON.parse(await readBody(response.body)).error.type).toBe('routing_error');
  });

  it('ends the observation and answers openai-shape 500 when model-less auth throws', async () => {
    // Arrange - credentials.resolve that throws; ended records observation statuses
    const ended: number[] = [];
    const deps: PipelineDeps = {
      ...makeDeps(true),
      credentials: {
        resolve: () => {
          throw new Error('env unset');
        },
      },
      observability: {
        begin: () => ({
          onEvent: () => {},
          captureOutbound: () => {},
          end: status => {
            ended.push(status);
          },
        }),
        reconfigure: () => {},
      },
    };
    const pipeline = createPipeline(deps);
    // Act
    const response = await pipeline.handle({
      path: '/v1/embeddings',
      method: 'POST',
      headers: {},
      body: '{}',
    });
    const parsed = JSON.parse(await readBody(response.body)) as {
      error: { type: string; message: string };
    };
    // Assert - openai shape (D5: model-less bodies are never decoded), 500 status,
    // and the observation is ended rather than left open
    expect(response.status).toBe(500);
    expect(parsed.error.type).toBe('internal_error');
    expect(parsed.error.message).toContain('env unset');
    expect(ended).toEqual([500]);
  });

  it('keeps non-/v1/ paths as 404 (D12)', async () => {
    // Arrange
    const pipeline = createPipeline(makeDeps(true));
    // Act
    const response = await pipeline.handle({
      path: '/healthz',
      method: 'POST',
      headers: {},
      body: '',
    });
    // Assert
    expect(response.status).toBe(404);
  });
});
