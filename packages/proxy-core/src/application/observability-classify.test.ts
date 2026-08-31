import { describe, expect, test } from 'vitest';
import { classifyCacheOutcome, classifyRequestType } from './observability-classify.js';

describe('classifyCacheOutcome', () => {
  test('NOUSAGE when usage is absent', () => {
    const outcome = classifyCacheOutcome(
      { present: false, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreate: 0 },
      { requestType: 'side', isFirstForSession: true },
      { hitThresholdPct: 80 },
    );
    expect(outcome).toEqual({ label: 'NOUSAGE', type: 'side', hitPct: 0 });
  });

  test('zero cacheRead is COLD on first sight, MISS afterwards', () => {
    const usage = {
      present: true,
      inputTokens: 100,
      outputTokens: 0,
      cacheRead: 0,
      cacheCreate: 0,
    };
    expect(
      classifyCacheOutcome(
        usage,
        { requestType: 'main', isFirstForSession: true },
        { hitThresholdPct: 80 },
      ).label,
    ).toBe('COLD');
    expect(
      classifyCacheOutcome(
        usage,
        { requestType: 'main', isFirstForSession: false },
        { hitThresholdPct: 80 },
      ).label,
    ).toBe('MISS');
  });

  test('PARTIAL below threshold, HIT at/above; hitPct clamped at 100', () => {
    const partial = {
      present: true,
      inputTokens: 100,
      outputTokens: 0,
      cacheRead: 50,
      cacheCreate: 0,
    };
    const hit = {
      present: true,
      inputTokens: 100,
      outputTokens: 0,
      cacheRead: 150,
      cacheCreate: 0,
    };
    expect(
      classifyCacheOutcome(
        partial,
        { requestType: 'main', isFirstForSession: false },
        { hitThresholdPct: 80 },
      ).label,
    ).toBe('PARTIAL');
    expect(
      classifyCacheOutcome(
        hit,
        { requestType: 'main', isFirstForSession: false },
        { hitThresholdPct: 80 },
      ),
    ).toEqual({ label: 'HIT', type: 'main', hitPct: 100 });
  });
});

describe('classifyRequestType', () => {
  test('no tools + small budget = side; tools or large budget = main', () => {
    expect(
      classifyRequestType({ toolsCount: 0, maxTokens: 2112 }, { sideMaxTokens: 4096 }),
    ).toBe('side');
    expect(
      classifyRequestType({ toolsCount: 0, maxTokens: 32000 }, { sideMaxTokens: 4096 }),
    ).toBe('main');
    expect(
      classifyRequestType({ toolsCount: 130, maxTokens: 2112 }, { sideMaxTokens: 4096 }),
    ).toBe('main');
  });

  test('missing/zero/negative maxTokens is unbounded (main)', () => {
    expect(classifyRequestType({ toolsCount: 0 }, { sideMaxTokens: 4096 })).toBe('main');
    expect(
      classifyRequestType({ toolsCount: 0, maxTokens: 0 }, { sideMaxTokens: 4096 }),
    ).toBe('main');
    expect(
      classifyRequestType({ toolsCount: 0, maxTokens: -1 }, { sideMaxTokens: 4096 }),
    ).toBe('main');
  });
});
