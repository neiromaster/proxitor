// src/proxy/observability/session-tracker.test.ts
import { describe, expect, it } from 'vitest';
import { SessionTracker } from './session-tracker.js';

describe('SessionTracker', () => {
  it('returns true on first sighting, false after', () => {
    const t = new SessionTracker({ maxEntries: 4, ttlMs: 1000 });
    expect(t.isFirstAndRemember('s1')).toBe(true);
    expect(t.isFirstAndRemember('s1')).toBe(false);
  });
  it('returns false for undefined sessionId', () => {
    expect(
      new SessionTracker({ maxEntries: 4, ttlMs: 1000 }).isFirstAndRemember(undefined),
    ).toBe(false);
  });
  it('FIFO-evicts oldest over the size cap, re-seen => true again', () => {
    const t = new SessionTracker({ maxEntries: 2, ttlMs: 1000 });
    t.isFirstAndRemember('s1');
    t.isFirstAndRemember('s2');
    t.isFirstAndRemember('s3'); // evicts s1
    expect(t.isFirstAndRemember('s1')).toBe(true); // s1 forgotten -> first again
  });
  it('treats an expired entry as first again', () => {
    let clock = 1000;
    const t = new SessionTracker({ maxEntries: 4, ttlMs: 100 }, () => clock);
    expect(t.isFirstAndRemember('s1')).toBe(true);
    clock += 200; // past TTL
    expect(t.isFirstAndRemember('s1')).toBe(true);
  });
});
