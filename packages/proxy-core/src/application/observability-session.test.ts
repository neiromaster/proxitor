import { describe, expect, test, vi } from 'vitest';
import { SessionTracker } from './observability-session.js';

describe('SessionTracker', () => {
  test('first-seen returns true, repeat within TTL returns false', () => {
    const now = vi.fn(() => 1000);
    const tracker = new SessionTracker({ maxEntries: 10, ttlMs: 5000 }, now);
    expect(tracker.isFirstAndRemember('s1')).toBe(true);
    expect(tracker.isFirstAndRemember('s1')).toBe(false);
  });

  test('repeat after TTL returns true', () => {
    const now = vi.fn(() => 1000);
    const tracker = new SessionTracker({ maxEntries: 10, ttlMs: 500 }, now);
    expect(tracker.isFirstAndRemember('s1')).toBe(true);
    now.mockReturnValue(1600);
    expect(tracker.isFirstAndRemember('s1')).toBe(true);
  });

  test('no sessionId always returns true', () => {
    const tracker = new SessionTracker({ maxEntries: 10, ttlMs: 5000 });
    expect(tracker.isFirstAndRemember(undefined)).toBe(true);
    expect(tracker.isFirstAndRemember(undefined)).toBe(true);
  });

  test('LRU eviction at maxEntries', () => {
    const tracker = new SessionTracker({ maxEntries: 3, ttlMs: 5000 });
    expect(tracker.isFirstAndRemember('s1')).toBe(true);
    expect(tracker.isFirstAndRemember('s2')).toBe(true);
    expect(tracker.isFirstAndRemember('s3')).toBe(true);
    expect(tracker.isFirstAndRemember('s4')).toBe(true);
    // s1 should be evicted, so s1 is now first-seen again
    expect(tracker.isFirstAndRemember('s1')).toBe(true);
  });

  test('applyConfig shrink evicts oldest without wiping map', () => {
    const tracker = new SessionTracker({ maxEntries: 10, ttlMs: 5000 });
    tracker.isFirstAndRemember('s1');
    tracker.isFirstAndRemember('s2');
    tracker.isFirstAndRemember('s3');
    tracker.applyConfig({ maxEntries: 2, ttlMs: 5000 });
    // After shrink, s1 is evicted, s2 and s3 remain
    // Don't call isFirstAndRemember on s1 (would reinsert it and evict s2)
    // Instead, insert a fresh entry and verify s3 survives
    expect(tracker.isFirstAndRemember('s4')).toBe(true); // New entry, evicts s2
    expect(tracker.isFirstAndRemember('s3')).toBe(false); // s3 still there (not first)
  });

  test('refresh moves session to end for LRU', () => {
    const tracker = new SessionTracker({ maxEntries: 3, ttlMs: 5000 });
    tracker.isFirstAndRemember('s1');
    tracker.isFirstAndRemember('s2');
    tracker.isFirstAndRemember('s3');
    // Refresh s1 - moves to end
    tracker.isFirstAndRemember('s1');
    // Now s2 should be evicted
    tracker.isFirstAndRemember('s4');
    expect(tracker.isFirstAndRemember('s2')).toBe(true);
    expect(tracker.isFirstAndRemember('s1')).toBe(false);
  });
});
