import type { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../helpers.js';

describe('normalizeMessages middleware (/v1/messages)', () => {
  let env: TestEnv;

  afterEach(async () => {
    if (env) await env.cleanup();
  });

  it('lifts a mid-thread role:system item into top-level system on /v1/messages', async () => {
    // Arrange — the real failing shape: a SessionStart hook payload injected as
    // role:"system" at messages[1], which strict Anthropic-format providers
    // (OpenRouter -> GLM) reject. The middleware must set bodyMutated and lift
    // it into the top-level system before forwarding.
    let captured: Record<string, unknown> = {};
    env = await createTestEnv({ normalizeMessages: true }, (upstream: Hono) => {
      upstream.all('/*', async c => {
        captured = (await c.req.json()) as Record<string, unknown>;
        return c.json({
          id: 'msg_x',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'glm-5.1',
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      });
    });

    // Act
    const res = await fetch(`${env.proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'glm-5.1',
        system: [{ type: 'text', text: 'system prompt' }],
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'system', content: 'SessionStart: ...' },
          { role: 'assistant', content: 'ok' },
        ],
      }),
    });

    // Assert — system lifted out of messages; alternation preserved.
    expect(res.status).toBe(200);
    const messages = captured.messages as { role?: string }[];
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(messages.some(m => m.role === 'system')).toBe(false);
    const system = captured.system as { text?: string }[];
    expect(system.some(b => b.text === 'SessionStart: ...')).toBe(true);
  });

  it('leaves role:system in messages when normalizeMessages is off', async () => {
    // Arrange — off is raw passthrough: the offending role:system survives.
    let captured: Record<string, unknown> = {};
    env = await createTestEnv({ normalizeMessages: false }, (upstream: Hono) => {
      upstream.all('/*', async c => {
        captured = (await c.req.json()) as Record<string, unknown>;
        return c.json({
          id: 'msg_x',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'glm-5.1',
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      });
    });

    // Act
    const res = await fetch(`${env.proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'glm-5.1',
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'system', content: 'x' },
        ],
      }),
    });

    // Assert
    expect(res.status).toBe(200);
    const messages = captured.messages as { role?: string }[];
    expect(messages.map(m => m.role)).toEqual(['user', 'system']);
  });
});
