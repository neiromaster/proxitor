import { describe, expect, it } from 'vitest';
import {
  formatGlobalCachingSummary,
  formatPerModelCachingSummary,
} from '../../src/commands/config/caching-summary.js';
import type { ModelOverride, ProxyConfig } from '../../src/config-schema.js';

const asConfig = (o: Partial<ProxyConfig>) => o;

describe('formatGlobalCachingSummary', () => {
  it('shows resolved defaults when fields are absent', () => {
    const out = formatGlobalCachingSummary(
      asConfig({
        cacheControl: undefined,
        cacheControlTtl: undefined,
        sessionId: undefined,
        normalizeVolatileSystem: undefined,
      }),
    );
    expect(out).toContain('cacheControl            = auto');
    expect(out).toContain('cacheControlTtl         = (default)');
    expect(out).toContain('sessionId               = auto');
    expect(out).toContain('normalizeVolatileSystem = off');
    expect(out).toContain('Anthropic');
    expect(out).toContain('all 3');
  });

  it('shows explicit values', () => {
    const out = formatGlobalCachingSummary(
      asConfig({
        cacheControl: 'always',
        cacheControlTtl: '1h',
        sessionId: 'skip',
        normalizeVolatileSystem: true,
      }),
    );
    expect(out).toContain('cacheControl            = always');
    expect(out).toContain('cacheControlTtl         = 1h');
    expect(out).toContain('sessionId               = skip');
    expect(out).toContain('normalizeVolatileSystem = on');
  });
});

describe('formatPerModelCachingSummary', () => {
  const globalCfg = asConfig({
    cacheControl: 'auto',
    cacheControlTtl: undefined,
    sessionId: 'auto',
    normalizeVolatileSystem: false,
  });

  it('shows inherit arrows when nothing is overridden', () => {
    const out = formatPerModelCachingSummary('claude-*', {}, globalCfg);
    expect(out).toContain('Caching for "claude-*"');
    expect(out).toContain('cacheControl            = (inherit -> auto)');
    expect(out).toContain('cacheControlTtl         = (inherit)');
    expect(out).toContain('sessionId               = (inherit -> auto)');
    expect(out).toContain('normalizeVolatileSystem = (inherit -> off)');
  });

  it('shows explicit overrides instead of inherit arrows', () => {
    const cur: ModelOverride = {
      cacheControl: 'always',
      sessionId: 'skip',
      normalizeVolatileSystem: true,
    };
    const out = formatPerModelCachingSummary('gpt-4o', cur, globalCfg);
    expect(out).toContain('cacheControl            = always');
    expect(out).toContain('sessionId               = skip');
    expect(out).toContain('normalizeVolatileSystem = on');
  });

  it('inherits TTL from a set global TTL', () => {
    const out = formatPerModelCachingSummary(
      'm',
      {},
      asConfig({ cacheControlTtl: '1h' }),
    );
    expect(out).toContain('cacheControlTtl         = (inherit -> 1h)');
  });
});
