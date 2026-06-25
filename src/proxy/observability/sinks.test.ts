// src/proxy/observability/sinks.test.ts
import { describe, expect, it } from 'vitest';
import { colorizeLabel, formatLine } from './sinks.js';
import type { CacheObservation } from './types.js';

const obs = (over: Partial<CacheObservation> = {}): CacheObservation => ({
  reqId: 'a1b2',
  status: 200,
  model: 'glm-4.5-air',
  requestType: 'main',
  toolsCount: 130,
  usage: { present: true, inputTokens: 48874, cacheRead: 48640, cacheCreate: 0 },
  outcome: { label: 'HIT', type: 'main', hitPct: 99 },
  ...over,
});

describe('formatLine', () => {
  it('renders HIT with %, read, in, model, type', () => {
    expect(formatLine(obs())).toBe(
      '[a1b2] HIT  99%  read 48640  in 48874  glm-4.5-air  [main]',
    );
  });
  it('renders MISS with provider when routing present', () => {
    expect(
      formatLine(
        obs({
          usage: { present: true, inputTokens: 61322, cacheRead: 0, cacheCreate: 0 },
          outcome: { label: 'MISS', type: 'main', hitPct: 0 },
          routing: { provider: 'Decart', strategy: 'auto', attempt: 1, fallback: false },
        }),
      ),
    ).toBe('[a1b2] MISS  in 61322  provider=Decart  glm-4.5-air  [main]');
  });
  it('renders NOUSAGE without cache/provider fields', () => {
    expect(
      formatLine(
        obs({
          usage: { present: false, inputTokens: 0, cacheRead: 0, cacheCreate: 0 },
          outcome: { label: 'NOUSAGE', type: 'main', hitPct: 0 },
        }),
      ),
    ).toBe('[a1b2] NOUSAGE  glm-4.5-air  [main]');
  });
  it('tags side requests', () => {
    expect(formatLine(obs({ requestType: 'side' }))).toContain('[side]');
  });
});

describe('colorizeLabel', () => {
  it('returns plain label when useColor false', () => {
    expect(colorizeLabel('HIT', false)).toBe('HIT');
  });
  it('wraps with ANSI when useColor true', () => {
    expect(colorizeLabel('MISS', true)).toBe('\x1b[31mMISS\x1b[0m');
  });
});
