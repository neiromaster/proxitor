import type { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../helpers.js';

describe('Upstream header casing (canonicalization)', () => {
  let env: TestEnv;

  afterEach(async () => {
    if (env) await env.cleanup();
  });

  it('forces a single clean content-type despite an odd-cased extra header', async () => {
    // Arrange — user-config extra header in ALL-CAPS plus provider injection,
    // which sets bodyMutated and therefore triggers the content-type forcing path.
    let capturedContentType: string | null = null;
    env = await createTestEnv(
      { provider: { only: 'deepinfra' }, headers: { 'CONTENT-TYPE': 'text/xml' } },
      (upstream: Hono) => {
        upstream.all('/*', async c => {
          capturedContentType = c.req.raw.headers.get('content-type');
          return c.json({ id: 'x', choices: [] });
        });
      },
    );

    // Act
    const res = await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });

    // Assert — must be exactly application/json, not a merged/corrupted value.
    expect(res.status).toBe(200);
    expect(capturedContentType).toBe('application/json');
  });
});
