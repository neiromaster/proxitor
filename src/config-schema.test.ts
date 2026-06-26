import { describe, expect, it } from 'vitest';
import { proxyConfigSchema } from './config-schema.js';

describe('observability config', () => {
  it('applies nested field defaults on partial override', () => {
    const parsed = proxyConfigSchema.parse({
      openrouterKey: 'k',
      observability: { hitThreshold: 50 },
    });
    expect(parsed.observability).toEqual({
      routerMetadata: true,
      hitThreshold: 50,
      sideMaxTokens: 4096,
      sessionMaxEntries: 4096,
      sessionTtlMs: 600000,
    });
  });

  it('rejects out-of-range hitThreshold', () => {
    expect(() =>
      proxyConfigSchema.parse({
        openrouterKey: 'k',
        observability: { hitThreshold: 150 },
      }),
    ).toThrow();
  });
});
