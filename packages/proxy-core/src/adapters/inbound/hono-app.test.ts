import { describe, expect, test } from 'vitest';
import type {
  PipelineRequest,
  PipelineResponse,
  ProxyPipeline,
} from '../../application/proxy-pipeline.js';
import { createProxyApp } from './hono-app.js';

const stubPipeline = (
  response: PipelineResponse,
): { pipeline: ProxyPipeline; requests: PipelineRequest[] } => {
  const requests: PipelineRequest[] = [];
  return {
    requests,
    pipeline: {
      handle: async request => {
        requests.push(request);
        return response;
      },
    },
  };
};

const OK: PipelineResponse = {
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: (async function* () {
    yield '{"ok":true}';
  })(),
};

describe('createProxyApp — inbound routing', () => {
  test('POST /v1/messages builds a PipelineRequest: query-stripped path, lowercased headers, text body', async () => {
    // Arrange
    const { pipeline, requests } = stubPipeline(OK);
    const app = createProxyApp({ pipeline, bodyLimitBytes: 1024 });
    // Act
    const res = await app.request('/v1/messages?beta=true', {
      method: 'POST',
      headers: { 'X-Custom': 'v', 'Content-Type': 'application/json' },
      body: '{"model":"gpt-5"}',
    });
    // Assert
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"ok":true}');
    expect(requests[0]).toEqual({
      path: '/v1/messages',
      method: 'POST',
      headers: { 'x-custom': 'v', 'content-type': 'application/json' },
      body: '{"model":"gpt-5"}',
    });
  });

  test('chat paths reject non-POST with 405 + Allow: POST (D-M5a-1)', async () => {
    const { pipeline } = stubPipeline(OK);
    const app = createProxyApp({ pipeline, bodyLimitBytes: 1024 });
    const res = await app.request('/v1/messages', { method: 'GET' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
    expect(await res.json()).toEqual({
      error: {
        message: expect.stringContaining('/v1/messages'),
        type: 'invalid_request_error',
      },
    });
    expect((await app.request('/v1/chat/completions', { method: 'PUT' })).status).toBe(
      405,
    );
  });

  test('/v1/models: GET passes through to the pipeline with empty body; POST → 405 + Allow: GET', async () => {
    const { pipeline, requests } = stubPipeline(OK);
    const app = createProxyApp({ pipeline, bodyLimitBytes: 1024 });
    expect((await app.request('/v1/models')).status).toBe(200);
    expect(requests[0]).toMatchObject({ path: '/v1/models', method: 'GET', body: '' });
    const post = await app.request('/v1/models', { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET');
  });

  test('other /v1/* POSTs pass through (model-less pipeline handling); non-POST/GET there → 404 JSON', async () => {
    const { pipeline, requests } = stubPipeline(OK);
    const app = createProxyApp({ pipeline, bodyLimitBytes: 1024 });
    expect(
      (await app.request('/v1/embeddings', { method: 'POST', body: '{"input":"x"}' }))
        .status,
    ).toBe(200);
    expect(requests[0]?.path).toBe('/v1/embeddings');
    expect((await app.request('/v1/embeddings', { method: 'DELETE' })).status).toBe(404);
  });

  test('bodies over the limit get an openai-shape 413', async () => {
    const { pipeline } = stubPipeline(OK);
    const app = createProxyApp({ pipeline, bodyLimitBytes: 8 });
    const res = await app.request('/v1/messages', {
      method: 'POST',
      body: 'x'.repeat(64),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: { message: expect.any(String), type: 'invalid_request_error' },
    });
  });

  test('non-/v1 paths get a JSON 404 (custom notFound, D-M5a-6)', async () => {
    const { pipeline } = stubPipeline(OK);
    const app = createProxyApp({ pipeline, bodyLimitBytes: 1024 });
    const res = await app.request('/health');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: {
        message: expect.stringContaining('/health'),
        type: 'invalid_request_error',
      },
    });
  });
});
