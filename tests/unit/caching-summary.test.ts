import { describe, expect, it } from 'vitest';
import {
  describeTtl,
  formatGlobalCachingSummary,
  formatPerModelCachingSummary,
} from '../../src/commands/config/caching-summary.js';
import type { ModelOverride, ProxyConfig } from '../../src/config-schema.js';

const asConfig = (o: Partial<ProxyConfig>) => o;

describe('describeTtl', () => {
  it('maps enum values to friendly labels and undefined to (default)', () => {
    expect(describeTtl(undefined)).toBe('(default)');
    expect(describeTtl('5m')).toBe('5m');
    expect(describeTtl('1h')).toBe('1h');
    expect(describeTtl('omit')).toBe('strip');
    expect(describeTtl('skip')).toBe('passthrough');
  });
});

describe('formatGlobalCachingSummary', () => {
  it('shows resolved defaults when fields are absent', () => {
    const out = formatGlobalCachingSummary(
      asConfig({
        recommended: false,
        cacheControl: undefined,
        cacheControlTtl: undefined,
        sessionId: undefined,
        normalizeVolatileSystem: undefined,
      }),
    );
    expect(out).toContain('cacheControl            = (default -> skip)');
    expect(out).toContain('cacheControlTtl         = (default)');
    expect(out).toContain('rewriteBlockTtl         = (default -> skip)');
    expect(out).toContain('sessionId               = (default -> skip)');
    expect(out).toContain('normalizeVolatileSystem = (default -> off)');
    expect(out).toContain('Anthropic');
    expect(out).toContain('all 3');
  });

  it('shows explicit values', () => {
    const out = formatGlobalCachingSummary(
      asConfig({
        cacheControl: 'always',
        cacheControlTtl: '1h',
        rewriteBlockTtl: 'auto',
        sessionId: 'skip',
        normalizeVolatileSystem: true,
      }),
    );
    expect(out).toContain('cacheControl            = always');
    expect(out).toContain('cacheControlTtl         = 1h');
    expect(out).toContain('rewriteBlockTtl         = auto');
    expect(out).toContain('sessionId               = skip');
    expect(out).toContain('normalizeVolatileSystem = on');
  });

  it('shows bare on/off only when normalizeVolatileSystem is explicitly set', () => {
    const off = formatGlobalCachingSummary(asConfig({ normalizeVolatileSystem: false }));
    expect(off).toContain('normalizeVolatileSystem = off');
    expect(off).not.toContain('default -> off');
  });

  it('shows friendly labels for omit/skip TTL', () => {
    const strip = formatGlobalCachingSummary(asConfig({ cacheControlTtl: 'omit' }));
    expect(strip).toContain('cacheControlTtl         = strip');
    const passthrough = formatGlobalCachingSummary(asConfig({ cacheControlTtl: 'skip' }));
    expect(passthrough).toContain('cacheControlTtl         = passthrough');
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
    expect(out).toContain('rewriteBlockTtl         = (inherit -> skip)');
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

  it('shows explicit rewriteBlockTtl override', () => {
    const out = formatPerModelCachingSummary(
      'm',
      { rewriteBlockTtl: 'always' } as ModelOverride,
      globalCfg,
    );
    expect(out).toContain('rewriteBlockTtl         = always');
  });

  it('inherits TTL from a set global TTL', () => {
    const out = formatPerModelCachingSummary(
      'm',
      {},
      asConfig({ cacheControlTtl: '1h' }),
    );
    expect(out).toContain('cacheControlTtl         = (inherit -> 1h)');
  });

  it('shows friendly labels for explicit + inherited omit/skip TTL', () => {
    const explicit = formatPerModelCachingSummary(
      'm',
      { cacheControlTtl: 'omit' },
      globalCfg,
    );
    expect(explicit).toContain('cacheControlTtl         = strip');

    const inherited = formatPerModelCachingSummary(
      'm',
      {},
      asConfig({ cacheControlTtl: 'skip' }),
    );
    expect(inherited).toContain('cacheControlTtl         = (inherit -> passthrough)');
  });
});
