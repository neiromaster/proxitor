// src/proxy/observability/observability.test.ts
import { describe, expect, it } from 'vitest';
import { Observability } from './observability.js';
import { SessionTracker } from './session-tracker.js';
import type { CacheObservation, RequestContext } from './types.js';

const req = (over: Partial<RequestContext> = {}): RequestContext => ({
  reqId: 'r1',
  model: 'm',
  sessionId: 's1',
  toolsCount: 10,
  requestType: 'main',
  ...over,
});

function withFakeSink(fn: (obs: CacheObservation) => void) {
  const sink = { emit: fn };
  return new Observability(
    new SessionTracker({ maxEntries: 8, ttlMs: 1000 }),
    [sink],
    80,
  );
}

describe('Observability.observe', () => {
  it('classifies and dispatches a full observation', () => {
    let got: CacheObservation | undefined;
    const o = withFakeSink(x => {
      got = x;
    });
    o.observe(
      req(),
      { usage: { present: true, inputTokens: 100, cacheRead: 90, cacheCreate: 0 } },
      200,
    );
    expect(got?.outcome.label).toBe('HIT');
    expect(got?.status).toBe(200);
    expect(got?.requestType).toBe('main');
  });
  it('first-session miss => COLD, second => MISS', () => {
    const seen: string[] = [];
    const o = withFakeSink(x => seen.push(x.outcome.label));
    o.observe(
      req({ sessionId: 's9' }),
      { usage: { present: true, inputTokens: 50, cacheRead: 0, cacheCreate: 0 } },
      200,
    );
    o.observe(
      req({ sessionId: 's9' }),
      { usage: { present: true, inputTokens: 50, cacheRead: 0, cacheCreate: 0 } },
      200,
    );
    expect(seen).toEqual(['COLD', 'MISS']);
  });
  it('defaults absent usage to NOUSAGE', () => {
    let got: CacheObservation | undefined;
    const o = withFakeSink(x => {
      got = x;
    });
    o.observe(req(), {}, 200);
    expect(got?.outcome.label).toBe('NOUSAGE');
  });
});
