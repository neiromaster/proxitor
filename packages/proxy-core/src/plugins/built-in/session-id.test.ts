import type { CanonicalRequest, PluginContext } from '@proxitor/plugin-api';
import { describe, expect, it } from 'vitest';
import {
  createSessionIdPlugin,
  deriveSessionId,
  type SessionIdPluginConfig,
} from './session-id.js';

type RawConfig = {
  mode?: 'auto' | 'skip';
};

function request(overrides: Partial<CanonicalRequest> = {}): CanonicalRequest {
  return {
    model: { logical: 'claude-sonnet-5', physical: 'gpt-5' },
    system: [{ type: 'text', text: 'sys prompt' }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'first user turn' }] }],
    params: {},
    stream: false,
    extensions: {},
    ...overrides,
  };
}

function ctx(config: RawConfig = {}): PluginContext<SessionIdPluginConfig> {
  return {
    requestId: 'r1',
    logger: console,
    clock: { now: () => 0 },
    random: { uuid: () => 'fallback-uuid' },
    config: config as SessionIdPluginConfig,
  };
}

describe('deriveSessionId', () => {
  it('is stable across turns of one conversation (growing history, same first user message)', async () => {
    // Arrange
    const turn1 = request();
    const turn2 = request({
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'first user turn' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
        { role: 'user', content: [{ type: 'text', text: 'second question' }] },
      ],
    });

    // Act
    const a = await deriveSessionId(turn1, () => 'fb');
    const b = await deriveSessionId(turn2, () => 'fb');

    // Assert
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs between conversations and models', async () => {
    // Arrange
    const base = request();
    const otherConversation = request({
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'different opening' }] },
      ],
    });
    const otherModel = request({ model: { logical: 'gpt-5', physical: 'gpt-5' } });

    // Act
    const a = await deriveSessionId(base, () => 'fb');
    const b = await deriveSessionId(otherConversation, () => 'fb');
    const c = await deriveSessionId(otherModel, () => 'fb');

    // Assert
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('is insensitive to cache-control marks (plugin order cannot drift it)', async () => {
    // Arrange
    const marked = request({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'first user turn',
              cacheControl: { type: 'ephemeral', ttl: '1h' },
            },
          ],
        },
      ],
    });

    // Act
    const a = await deriveSessionId(request(), () => 'fb');
    const b = await deriveSessionId(marked, () => 'fb');

    // Assert
    expect(a).toBe(b);
  });

  it('falls back when there is no system and no user content', async () => {
    // Arrange
    const empty = request({ system: [], messages: [] });

    // Act
    const id = await deriveSessionId(empty, () => 'fb');

    // Assert
    expect(id).toBe('fb');
  });
});

describe('session-id plugin', () => {
  it('writes x-session-id into outboundHeaders preserving existing entries', async () => {
    // Arrange
    const req = request({ outboundHeaders: { 'x-custom': 'kept' } });

    // Act
    const result = (await createSessionIdPlugin().onRequest?.(ctx(), req)) as
      | CanonicalRequest
      | undefined;

    // Assert
    expect(result?.outboundHeaders?.['x-custom']).toBe('kept');
    expect(result?.outboundHeaders?.['x-session-id']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('mode skip returns the request untouched (same reference)', async () => {
    // Arrange
    const req = request();

    // Act
    const result = await createSessionIdPlugin().onRequest?.(ctx({ mode: 'skip' }), req);

    // Assert
    expect(result).toBe(req);
  });

  it('defaults mode to auto for a bare declaration', () => {
    // Arrange
    const plugin = createSessionIdPlugin();

    // Act
    const config = plugin.validateConfig?.(undefined);

    // Assert
    expect(config).toEqual({ mode: 'auto' });
  });

  it('reuses one fallback id across requests and hands it over via state', async () => {
    // Arrange
    const plugin = createSessionIdPlugin();
    const empty = () => request({ system: [], messages: [] });

    // Act
    const first = (await plugin.onRequest?.(ctx(), empty())) as
      | CanonicalRequest
      | undefined;
    const second = (await plugin.onRequest?.(ctx(), empty())) as
      | CanonicalRequest
      | undefined;
    const state = plugin.exportState?.();
    const successor = createSessionIdPlugin();
    successor.restoreState?.(state);
    const afterReload = (await successor.onRequest?.(ctx(), empty())) as
      | CanonicalRequest
      | undefined;

    // Assert
    expect(first?.outboundHeaders?.['x-session-id']).toBe('fallback-uuid');
    expect(second?.outboundHeaders?.['x-session-id']).toBe('fallback-uuid');
    expect(afterReload?.outboundHeaders?.['x-session-id']).toBe('fallback-uuid');
  });
});
