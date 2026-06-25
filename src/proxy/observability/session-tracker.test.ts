// src/proxy/observability/session-tracker.test.ts
import { describe, expect, it } from 'vitest';
import { SessionTracker } from './session-tracker.js';

describe('SessionTracker', () => {
  it('returns true on first sighting, false after', () => {
    const t = new SessionTracker({ maxEntries: 4, ttlMs: 1000 });
    expect(t.isFirstAndRemember('s1')).toBe(true);
    expect(t.isFirstAndRemember('s1')).toBe(false);
  });
  it('treats undefined sessionId as first (COLD reachable without session tracking)', () => {
    // No session id → can't prove a repeat, so default to first-seen.
    // Returning false would make the COLD label permanently unreachable.
    expect(
      new SessionTracker({ maxEntries: 4, ttlMs: 1000 }).isFirstAndRemember(undefined),
    ).toBe(true);
  });
  it('evicts least-recently-used, keeping an active session alive (LRU)', () => {
    // s1 seen first but stays active; s3's eviction must drop the idle s2, not s1.
    const t = new SessionTracker({ maxEntries: 2, ttlMs: 1000 });
    t.isFirstAndRemember('s1');
    t.isFirstAndRemember('s2');
    t.isFirstAndRemember('s1'); // refreshes s1 recency → s2 is now oldest
    t.isFirstAndRemember('s3'); // evicts s2
    expect(t.isFirstAndRemember('s1')).toBe(false); // s1 survived
    expect(t.isFirstAndRemember('s2')).toBe(true); // s2 evicted → first again
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
  it('applyConfig preserves remembered sessions on a no-op reload', () => {
    // Arrange — a reload that doesn't change capacity must not wipe the map.
    const t = new SessionTracker({ maxEntries: 4, ttlMs: 1000 });
    t.isFirstAndRemember('s1'); // first

    // Act
    t.applyConfig({ maxEntries: 4, ttlMs: 1000 });

    // Assert — s1 is still remembered.
    expect(t.isFirstAndRemember('s1')).toBe(false);
  });
  it('applyConfig evicts oldest down to a shrunken capacity', () => {
    // Arrange
    const t = new SessionTracker({ maxEntries: 4, ttlMs: 1000 });
    t.isFirstAndRemember('s1');
    t.isFirstAndRemember('s2');
    t.isFirstAndRemember('s3'); // insertion order: s1, s2, s3

    // Act — shrink to 1: keeps the most-recently-inserted (s3).
    t.applyConfig({ maxEntries: 1, ttlMs: 1000 });

    // Assert
    expect(t.isFirstAndRemember('s3')).toBe(false); // survived
    expect(t.isFirstAndRemember('s1')).toBe(true); // evicted → first again
  });
});
