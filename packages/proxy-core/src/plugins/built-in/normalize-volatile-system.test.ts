import type { CanonicalRequest } from '@proxitor/plugin-api';
import { describe, expect, it } from 'vitest';
import {
  createNormalizeVolatileSystemPlugin,
  normalizeVolatileText,
} from './normalize-volatile-system.js';

function request(system: CanonicalRequest['system']): CanonicalRequest {
  return {
    model: { logical: 'claude-sonnet-5', physical: 'claude-sonnet-5' },
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    params: {},
    stream: false,
    extensions: {},
  };
}

const ctx = {
  requestId: 'r1',
  logger: console,
  clock: { now: () => 0 },
  random: { uuid: () => 'u' },
  config: undefined,
};

describe('normalizeVolatileText', () => {
  it('neutralizes the per-turn cch hash', () => {
    // Arrange
    const text = 'system prompt cch=deadbeef99 more';

    // Act
    const result = normalizeVolatileText(text);

    // Assert
    expect(result).toBe('system prompt cch=00000 more');
  });

  it('keeps the readable semver and zeroes the cc_version build hash', () => {
    // Arrange
    const text = 'cc_version=2.1.3.cafe1234 tail';

    // Act
    const result = normalizeVolatileText(text);

    // Assert
    expect(result).toBe('cc_version=2.1.3.0 tail');
  });

  it('returns stable text unchanged (identity)', () => {
    // Arrange
    const text = 'no volatile markers here';

    // Act
    const result = normalizeVolatileText(text);

    // Assert
    expect(result).toBe(text);
  });
});

describe('normalize-volatile-system plugin', () => {
  it('normalizes every volatile system block and preserves clean blocks by reference', async () => {
    // Arrange
    const clean = { type: 'text' as const, text: 'clean' };
    const req = request([
      clean,
      { type: 'text', text: 'cch=abc123' },
      { type: 'text', text: 'cc_version=1.0.0.deadbeef' },
    ]);

    // Act
    const pluginResult = await createNormalizeVolatileSystemPlugin().onRequest?.(
      ctx,
      req,
    );
    const result: CanonicalRequest = pluginResult as CanonicalRequest;

    // Assert
    expect(result.system[0]).toBe(clean);
    expect(result.system[1]?.text).toBe('cch=00000');
    expect(result.system[2]?.text).toBe('cc_version=1.0.0.0');
  });

  it('returns the same request object when nothing changed', async () => {
    // Arrange
    const req = request([{ type: 'text', text: 'clean' }]);

    // Act
    const pluginResult = await createNormalizeVolatileSystemPlugin().onRequest?.(
      ctx,
      req,
    );
    const result: CanonicalRequest = pluginResult as CanonicalRequest;

    // Assert
    expect(result).toBe(req);
  });
});
