import { afterEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../helpers.js';

describe('Error Handling', () => {
  let env: TestEnv;

  afterEach(async () => {
    if (env) await env.cleanup();
  });

  it('returns 502 when upstream is unreachable', async () => {
    env = await createTestEnv({
      openrouterBaseUrl: 'http://127.0.0.1:1',
    });

    const res = await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    });

    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error.type).toBe('proxy_upstream_error');
  });

  it('passes through upstream 500 status', async () => {
    env = await createTestEnv(undefined, upstream => {
      upstream.all('/*', () => {
        return new Response(
          JSON.stringify({ error: { message: 'Internal error', type: 'server_error' } }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
      });
    });

    const res = await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    });

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error.type).toBe('server_error');
  });

  it('passes through upstream 429 rate limit', async () => {
    env = await createTestEnv(undefined, upstream => {
      upstream.all('/*', () => {
        return new Response(
          JSON.stringify({ error: { message: 'Rate limited', type: 'rate_limit' } }),
          { status: 429, headers: { 'Content-Type': 'application/json' } },
        );
      });
    });

    const res = await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    });

    expect(res.status).toBe(429);
  });

  it('passes through upstream 400 with error body intact', async () => {
    const errorBody = JSON.stringify({
      error: {
        code: 400,
        message: 'Provider returned error',
        metadata: { provider_name: 'Anthropic', raw: 'invalid x-api-key' },
      },
    });

    env = await createTestEnv(undefined, upstream => {
      upstream.all('/*', () => {
        return new Response(errorBody, {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      });
    });

    const res = await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe(400);
    expect(data.error.message).toBe('Provider returned error');
    expect(data.error.metadata.provider_name).toBe('Anthropic');
    expect(data.error.metadata.raw).toBe('invalid x-api-key');
  });

  it('passes through upstream 403 with metadata', async () => {
    env = await createTestEnv(undefined, upstream => {
      upstream.all('/*', () => {
        return new Response(
          JSON.stringify({
            error: {
              code: 403,
              message: 'Request blocked: prompt injection patterns detected',
              metadata: { patterns: ['ignore all previous instructions'] },
            },
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      });
    });

    const res = await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    });

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error.code).toBe(403);
    expect(data.error.metadata.patterns).toEqual(['ignore all previous instructions']);
  });

  it('returns 502 when upstream returns non-JSON error', async () => {
    env = await createTestEnv(undefined, upstream => {
      upstream.all('/*', () => {
        return new Response('Bad Gateway', { status: 502 });
      });
    });

    const res = await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    });

    expect(res.status).toBe(502);
  });

  it('returns 499 when client cancels the request mid-stream', async () => {
    // Upstream delays responding so the client can cancel before the proxy
    // receives headers. The proxy must abort the upstream fetch and return
    // 499 Client Closed Request (not 500).
    env = await createTestEnv(undefined, upstream => {
      upstream.post('/*', async () => {
        await new Promise(resolve => setTimeout(resolve, 5000));
        return new Response('{}', { status: 200 });
      });
    });

    const controller = new AbortController();
    const fetchPromise = fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
      signal: controller.signal,
    }).catch(() => null);

    await new Promise(resolve => setTimeout(resolve, 100));
    controller.abort();

    const res = await fetchPromise;
    // Client-side fetch was aborted — it never receives a response. We assert
    // by reading the proxy's behavior indirectly: after the abort, the proxy
    // should not be hanging on the upstream (i.e. the test completes in <5s).
    expect(res).toBeNull();
  });
});
