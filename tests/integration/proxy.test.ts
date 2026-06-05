import { afterEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../helpers.js';

/** Register a catch-all handler on the upstream Hono app */
function catchAll(
  upstream: Hono,
  handler: (c: import('hono').Context) => Promise<Response>,
) {
  upstream.all('/*', handler);
}

// Need Hono import for the type above
import type { Hono } from 'hono';

describe('Proxy Integration', () => {
  let env: TestEnv;

  afterEach(async () => {
    if (env) await env.cleanup();
  });

  it('injects provider routing into POST /v1/chat/completions', async () => {
    let capturedBody: Record<string, unknown> = {};
    let capturedHeaders: Record<string, string> = {};

    env = await createTestEnv({ provider: { only: 'deepinfra' } }, upstream => {
      catchAll(upstream, async c => {
        capturedBody = await c.req.json().catch(() => ({}));
        capturedHeaders = Object.fromEntries(c.req.raw.headers.entries());
        return c.json({ id: 'test', choices: [] });
      });
    });

    const res = await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    expect(res.status).toBe(200);
    expect(capturedBody.provider).toEqual({ only: ['deepinfra'] });
    expect(capturedBody.model).toBe('claude-sonnet-4-20250514');
    expect(capturedHeaders['authorization']).toBe('Bearer test-api-key');
    expect(capturedHeaders['http-referer']).toBe('http://localhost');
    expect(capturedHeaders['x-openrouter-title']).toBe('proxitor-test');
  });

  it('injects provider for POST /v1/messages (Anthropic)', async () => {
    let capturedBody: Record<string, unknown> = {};

    env = await createTestEnv(
      { provider: { order: ['anthropic', 'deepinfra'] } },
      upstream => {
        catchAll(upstream, async c => {
          capturedBody = await c.req.json().catch(() => ({}));
          return c.json({ id: 'msg_test', content: [] });
        });
      },
    );

    const res = await fetch(`${env.proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
      }),
    });

    expect(res.status).toBe(200);
    expect(capturedBody.provider).toEqual({
      order: ['anthropic', 'deepinfra'],
      allow_fallbacks: true,
    });
  });

  it('injects provider for POST /v1/responses (OpenAI Responses)', async () => {
    let capturedBody: Record<string, unknown> = {};

    env = await createTestEnv({ provider: { ignore: 'slow-provider' } }, upstream => {
      catchAll(upstream, async c => {
        capturedBody = await c.req.json().catch(() => ({}));
        return c.json({ id: 'resp_test' });
      });
    });

    const res = await fetch(`${env.proxyUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', input: 'test' }),
    });

    expect(res.status).toBe(200);
    expect(capturedBody.provider).toEqual({ ignore: ['slow-provider'] });
  });

  it('applies model-specific overrides', async () => {
    let capturedBody: Record<string, unknown> = {};

    env = await createTestEnv(
      {
        provider: { only: 'openai' },
        modelOverrides: {
          'claude-*': { provider: { only: 'anthropic' } },
        },
      },
      upstream => {
        catchAll(upstream, async c => {
          capturedBody = await c.req.json().catch(() => ({}));
          return c.json({ id: 'test' });
        });
      },
    );

    await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });

    expect(capturedBody.provider).toEqual({ only: ['anthropic'] });
  });

  it('applies custom headers from model overrides', async () => {
    let capturedHeaders: Record<string, string> = {};

    env = await createTestEnv(
      {
        modelOverrides: {
          'gpt-*': { headers: { 'X-Model-Family': 'gpt', 'X-Custom': 'value' } },
        },
      },
      upstream => {
        catchAll(upstream, async c => {
          capturedHeaders = Object.fromEntries(c.req.raw.headers.entries());
          return c.json({ id: 'test' });
        });
      },
    );

    await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
    });

    expect(capturedHeaders['x-model-family']).toBe('gpt');
    expect(capturedHeaders['x-custom']).toBe('value');
  });

  it('passes GET requests without body modification', async () => {
    let capturedMethod = '';

    env = await createTestEnv({ provider: { only: 'test' } }, upstream => {
      catchAll(upstream, c => {
        capturedMethod = c.req.method;
        return c.json({ data: [], object: 'list' });
      });
    });

    const res = await fetch(`${env.proxyUrl}/v1/models`);
    expect(res.status).toBe(200);
    expect(capturedMethod).toBe('GET');

    const data = await res.json();
    expect(data.data).toEqual([]);
  });

  it('strips client auth headers and adds proxy auth', async () => {
    let capturedHeaders: Record<string, string> = {};

    env = await createTestEnv(undefined, upstream => {
      catchAll(upstream, async c => {
        capturedHeaders = Object.fromEntries(c.req.raw.headers.entries());
        return c.json({ id: 'test' });
      });
    });

    await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer sk-client-secret-key',
        'X-Api-Key': 'client-api-key',
      },
      body: JSON.stringify({ model: 'test', messages: [] }),
    });

    // Client auth should be stripped
    expect(capturedHeaders['authorization']).not.toContain('sk-client-secret-key');
    expect(capturedHeaders['authorization']).toBe('Bearer test-api-key');
    expect(capturedHeaders['x-api-key']).toBeUndefined();
  });

  it('does not inject provider when no provider config is set', async () => {
    let capturedBody: Record<string, unknown> = {};

    env = await createTestEnv(undefined, upstream => {
      catchAll(upstream, async c => {
        capturedBody = await c.req.json().catch(() => ({}));
        return c.json({ id: 'test' });
      });
    });

    await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    });

    expect(capturedBody.provider).toBeUndefined();
  });
});
