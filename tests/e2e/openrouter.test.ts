import { afterEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../helpers.js';

const apiKey = process.env.OPENROUTER_API_KEY;
const describeE2e = apiKey ? describe : describe.skip;

describeE2e('E2E: OpenRouter', () => {
  let env: TestEnv;

  afterEach(async () => {
    if (env) await env.cleanup();
  });

  it('[e2e-basic] gets a chat completion from OpenRouter', async () => {
    env = await createTestEnv({
      openrouterKey: apiKey!,
      openrouterBaseUrl: 'https://openrouter.ai/api',
    });

    const res = await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen/qwen3-235b-a22b-2507',
        messages: [{ role: 'user', content: 'Reply with exactly: basic-test-ok' }],
        max_tokens: 10,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.choices).toBeDefined();
    expect(data.choices.length).toBeGreaterThan(0);
  });

  it('[e2e-stream] streams a chat completion from OpenRouter', async () => {
    env = await createTestEnv({
      openrouterKey: apiKey!,
      openrouterBaseUrl: 'https://openrouter.ai/api',
    });

    const res = await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen/qwen3-235b-a22b-2507',
        messages: [{ role: 'user', content: 'Reply with exactly: stream-test-ok' }],
        max_tokens: 10,
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const text = await res.text();
    expect(text).toContain('data: ');
    expect(text).toContain('[DONE]');
  });

  it('[e2e-deepinfra-only] routes through deepinfra only', async () => {
    env = await createTestEnv({
      openrouterKey: apiKey!,
      openrouterBaseUrl: 'https://openrouter.ai/api',
      provider: { only: 'deepinfra' },
    });

    const res = await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen/qwen3-235b-a22b-2507',
        messages: [
          { role: 'user', content: 'Reply with exactly: deepinfra-only-test-ok' },
        ],
        max_tokens: 10,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.choices.length).toBeGreaterThan(0);
    expect(data.provider).toBe('DeepInfra');
  });

  it('[e2e-novita-order] routes through novita via order', async () => {
    env = await createTestEnv({
      openrouterKey: apiKey!,
      openrouterBaseUrl: 'https://openrouter.ai/api',
      provider: { order: ['novita', 'deepinfra'] },
    });

    const res = await fetch(`${env.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen/qwen3-235b-a22b-2507',
        messages: [{ role: 'user', content: 'Reply with exactly: novita-order-test-ok' }],
        max_tokens: 10,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.choices.length).toBeGreaterThan(0);
    expect(data.provider).toBe('Novita');
  });

  it('[e2e-health] shows real config in health endpoint', async () => {
    env = await createTestEnv({
      openrouterKey: apiKey!,
      openrouterBaseUrl: 'https://openrouter.ai/api',
      provider: { only: 'deepinfra' },
    });

    const res = await fetch(`${env.proxyUrl}/health`);
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.upstream).toBe('https://openrouter.ai/api');
    expect(data.provider).toEqual({ only: ['deepinfra'] });
  });
});
