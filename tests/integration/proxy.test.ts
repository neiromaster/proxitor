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
    expect(capturedHeaders['http-referer']).toBe(
      'https://github.com/neiromaster/proxitor',
    );
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

  // --- cache_control integration ---

  it('injects cache_control for Anthropic model on /v1/chat/completions with auto mode', async () => {
    let capturedBody: Record<string, unknown> = {};

    env = await createTestEnv({ cacheControl: 'auto' }, upstream => {
      catchAll(upstream, async c => {
        capturedBody = await c.req.json().catch(() => ({}));
        return c.json({ id: 'test', choices: [] });
      });
    });

    await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    expect(capturedBody.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('does not inject cache_control for non-Anthropic model on /v1/chat/completions with auto mode', async () => {
    let capturedBody: Record<string, unknown> = {};

    env = await createTestEnv({ cacheControl: 'auto' }, upstream => {
      catchAll(upstream, async c => {
        capturedBody = await c.req.json().catch(() => ({}));
        return c.json({ id: 'test', choices: [] });
      });
    });

    await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    expect(capturedBody.cache_control).toBeUndefined();
  });

  it('injects cache_control for any model on /v1/chat/completions with always mode', async () => {
    let capturedBody: Record<string, unknown> = {};

    env = await createTestEnv({ cacheControl: 'always' }, upstream => {
      catchAll(upstream, async c => {
        capturedBody = await c.req.json().catch(() => ({}));
        return c.json({ id: 'test', choices: [] });
      });
    });

    await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    expect(capturedBody.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('injects cache_control for any model on /v1/messages (always safe endpoint)', async () => {
    let capturedBody: Record<string, unknown> = {};

    env = await createTestEnv({ cacheControl: 'auto' }, upstream => {
      catchAll(upstream, async c => {
        capturedBody = await c.req.json().catch(() => ({}));
        return c.json({ id: 'msg_test', content: [] });
      });
    });

    await fetch(`${env.proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
      }),
    });

    expect(capturedBody.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('injects cache_control for any model on /v1/responses', async () => {
    let capturedBody: Record<string, unknown> = {};

    env = await createTestEnv({ cacheControl: 'auto' }, upstream => {
      catchAll(upstream, async c => {
        capturedBody = await c.req.json().catch(() => ({}));
        return c.json({ id: 'resp_test' });
      });
    });

    await fetch(`${env.proxyUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', input: 'test' }),
    });

    expect(capturedBody.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('does not inject cache_control when mode is never', async () => {
    let capturedBody: Record<string, unknown> = {};

    env = await createTestEnv({ cacheControl: 'never' }, upstream => {
      catchAll(upstream, async c => {
        capturedBody = await c.req.json().catch(() => ({}));
        return c.json({ id: 'test' });
      });
    });

    await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    expect(capturedBody.cache_control).toBeUndefined();
  });

  // --- session_id integration ---

  it('derives session_id from X-Claude-Code-Session-Id header with auto mode', async () => {
    let capturedBody: Record<string, unknown> = {};
    let capturedHeaders: Record<string, string> = {};

    env = await createTestEnv({ sessionId: 'auto' }, upstream => {
      catchAll(upstream, async c => {
        capturedBody = await c.req.json().catch(() => ({}));
        capturedHeaders = Object.fromEntries(c.req.raw.headers.entries());
        return c.json({ id: 'test' });
      });
    });

    await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Claude-Code-Session-Id': 'my-session-123',
      },
      body: JSON.stringify({ model: 'test', messages: [] }),
    });

    expect(capturedBody.session_id).toBe('my-session-123');
    expect(capturedHeaders['x-session-id']).toBe('my-session-123');
    // Client header should be stripped
    expect(capturedHeaders['x-claude-code-session-id']).toBeUndefined();
  });

  it('injects proxy-generated session_id in auto mode when no client header', async () => {
    let capturedBody: Record<string, unknown> = {};
    let capturedHeaders: Record<string, string> = {};

    env = await createTestEnv({ sessionId: 'auto' }, upstream => {
      catchAll(upstream, async c => {
        capturedBody = await c.req.json().catch(() => ({}));
        capturedHeaders = Object.fromEntries(c.req.raw.headers.entries());
        return c.json({ id: 'test' });
      });
    });

    await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    });

    // Auto mode now falls back to proxy UUID for maximum sticky routing
    expect(typeof capturedBody.session_id).toBe('string');
    expect(capturedBody.session_id.length).toBeGreaterThan(0);
    expect(capturedHeaders['x-session-id']).toBe(capturedBody.session_id);
  });

  it('injects generated session_id with always mode', async () => {
    let capturedBody: Record<string, unknown> = {};
    let capturedHeaders: Record<string, string> = {};

    env = await createTestEnv({ sessionId: 'always' }, upstream => {
      catchAll(upstream, async c => {
        capturedBody = await c.req.json().catch(() => ({}));
        capturedHeaders = Object.fromEntries(c.req.raw.headers.entries());
        return c.json({ id: 'test' });
      });
    });

    await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    });

    expect(typeof capturedBody.session_id).toBe('string');
    expect(capturedBody.session_id.length).toBeGreaterThan(0);
    expect(capturedHeaders['x-session-id']).toBe(capturedBody.session_id);
  });

  it('does not inject session_id when mode is never', async () => {
    let capturedBody: Record<string, unknown> = {};

    env = await createTestEnv({ sessionId: 'never' }, upstream => {
      catchAll(upstream, async c => {
        capturedBody = await c.req.json().catch(() => ({}));
        return c.json({ id: 'test' });
      });
    });

    await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Claude-Code-Session-Id': 'should-be-ignored',
      },
      body: JSON.stringify({ model: 'test', messages: [] }),
    });

    expect(capturedBody.session_id).toBeUndefined();
  });

  it('strips x-session-id from incoming headers (prevents bypass)', async () => {
    let capturedHeaders: Record<string, string> = {};

    env = await createTestEnv({ sessionId: 'never' }, upstream => {
      catchAll(upstream, async c => {
        capturedHeaders = Object.fromEntries(c.req.raw.headers.entries());
        return c.json({ id: 'test' });
      });
    });

    await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': 'malicious-session-bypass',
      },
      body: JSON.stringify({ model: 'test', messages: [] }),
    });

    // Client-sent x-session-id should be stripped, preventing bypass of sessionId: 'never'
    expect(capturedHeaders['x-session-id']).toBeUndefined();
  });

  it('sets x-session-id header to match injected body session_id', async () => {
    let capturedBody: Record<string, unknown> = {};
    let capturedHeaders: Record<string, string> = {};

    env = await createTestEnv({ sessionId: 'auto' }, upstream => {
      catchAll(upstream, async c => {
        capturedBody = await c.req.json().catch(() => ({}));
        capturedHeaders = Object.fromEntries(c.req.raw.headers.entries());
        return c.json({ id: 'test' });
      });
    });

    await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Claude-Code-Session-Id': 'header-session',
      },
      body: JSON.stringify({ model: 'test', messages: [] }),
    });

    // Both body and header should use the same session ID
    expect(capturedBody.session_id).toBe('header-session');
    expect(capturedHeaders['x-session-id']).toBe('header-session');
  });

  it('preserves existing session_id in body and uses it for header', async () => {
    let capturedBody: Record<string, unknown> = {};
    let capturedHeaders: Record<string, string> = {};

    env = await createTestEnv({ sessionId: 'auto' }, upstream => {
      catchAll(upstream, async c => {
        capturedBody = await c.req.json().catch(() => ({}));
        capturedHeaders = Object.fromEntries(c.req.raw.headers.entries());
        return c.json({ id: 'test' });
      });
    });

    await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Claude-Code-Session-Id': 'proxy-derived-session',
      },
      body: JSON.stringify({
        model: 'test',
        messages: [],
        session_id: 'client-existing-session',
      }),
    });

    // Body keeps existing session_id (not overwritten)
    expect(capturedBody.session_id).toBe('client-existing-session');
    // Header uses the existing session_id from body (consistent with body)
    expect(capturedHeaders['x-session-id']).toBe('client-existing-session');
  });

  // --- combined injection ---

  it('injects provider + cache_control + session_id together', async () => {
    let capturedBody: Record<string, unknown> = {};
    let capturedHeaders: Record<string, string> = {};

    env = await createTestEnv(
      {
        provider: { only: 'anthropic' },
        cacheControl: 'auto',
        sessionId: 'auto',
      },
      upstream => {
        catchAll(upstream, async c => {
          capturedBody = await c.req.json().catch(() => ({}));
          capturedHeaders = Object.fromEntries(c.req.raw.headers.entries());
          return c.json({ id: 'test', choices: [] });
        });
      },
    );

    await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Claude-Code-Session-Id': 'combined-session',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    expect(capturedBody.provider).toEqual({ only: ['anthropic'] });
    expect(capturedBody.cache_control).toEqual({ type: 'ephemeral' });
    expect(capturedBody.session_id).toBe('combined-session');
    expect(capturedHeaders['x-session-id']).toBe('combined-session');
  });

  it('applies per-model cacheControl override in integration', async () => {
    let capturedBody: Record<string, unknown> = {};

    env = await createTestEnv(
      {
        cacheControl: 'auto',
        modelOverrides: {
          'gpt-*': { cacheControl: 'never' },
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
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    // gpt-4o on /v1/chat/completions: auto would skip, never explicitly skips
    expect(capturedBody.cache_control).toBeUndefined();
  });
});
