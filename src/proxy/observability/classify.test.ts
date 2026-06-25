// src/proxy/observability/classify.test.ts
import { describe, expect, it } from 'vitest';
import { classifyCacheOutcome, classifyRequestType } from './classify.js';
import type { ExtractedUsage } from './types.js';

const usage = (over: Partial<ExtractedUsage> = {}): ExtractedUsage => ({
  present: true,
  inputTokens: 0,
  cacheRead: 0,
  cacheCreate: 0,
  ...over,
});

describe('classifyRequestType', () => {
  it('is side when no tools and max_tokens within budget', () => {
    expect(
      classifyRequestType({ toolsCount: 0, maxTokens: 2112 }, { sideMaxTokens: 4096 }),
    ).toBe('side');
  });
  it('is main when no tools but large budget (avoids false side)', () => {
    expect(
      classifyRequestType({ toolsCount: 0, maxTokens: 32000 }, { sideMaxTokens: 4096 }),
    ).toBe('main');
  });
  it('is main when tools present regardless of budget', () => {
    expect(
      classifyRequestType({ toolsCount: 130, maxTokens: 2112 }, { sideMaxTokens: 4096 }),
    ).toBe('main');
  });
  it('is main when max_tokens missing (Infinity fail-safe)', () => {
    expect(classifyRequestType({ toolsCount: 0 }, { sideMaxTokens: 4096 })).toBe('main');
  });
});

describe('classifyCacheOutcome', () => {
  const opts = { hitThresholdPct: 80 };
  it('NOUSAGE when usage absent', () => {
    expect(
      classifyCacheOutcome(
        usage({ present: false }),
        { requestType: 'main', isFirstForSession: true },
        opts,
      ).label,
    ).toBe('NOUSAGE');
  });
  it('COLD on first-session miss', () => {
    expect(
      classifyCacheOutcome(
        usage({ inputTokens: 1000 }),
        { requestType: 'main', isFirstForSession: true },
        opts,
      ).label,
    ).toBe('COLD');
  });
  it('MISS on repeat-session miss', () => {
    expect(
      classifyCacheOutcome(
        usage({ inputTokens: 1000 }),
        { requestType: 'main', isFirstForSession: false },
        opts,
      ).label,
    ).toBe('MISS');
  });
  it('HIT at/above threshold', () => {
    const o = classifyCacheOutcome(
      usage({ inputTokens: 100, cacheRead: 80 }),
      { requestType: 'main', isFirstForSession: false },
      opts,
    );
    expect(o.label).toBe('HIT');
    expect(o.hitPct).toBe(80);
  });
  it('PARTIAL below threshold', () => {
    expect(
      classifyCacheOutcome(
        usage({ inputTokens: 100, cacheRead: 79 }),
        { requestType: 'main', isFirstForSession: false },
        opts,
      ).label,
    ).toBe('PARTIAL');
  });
  it('clamps hitPct at 100 when cacheRead exceeds inputTokens', () => {
    // A non-standard provider can report cached tokens excluded from
    // prompt_tokens → cacheRead > inputTokens → hitPct must not exceed 100.
    const o = classifyCacheOutcome(
      usage({ inputTokens: 1000, cacheRead: 4000 }),
      { requestType: 'main', isFirstForSession: false },
      opts,
    );
    expect(o.label).toBe('HIT');
    expect(o.hitPct).toBe(100);
  });
});
