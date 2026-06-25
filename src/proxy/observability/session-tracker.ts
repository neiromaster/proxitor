// src/proxy/observability/session-tracker.ts
export class SessionTracker {
  private readonly seen = new Map<string, number>(); // sessionId -> lastSeenTs (insertion-ordered)
  constructor(opts: { maxEntries: number; ttlMs: number }, now: () => number = Date.now) {
    this.opts = opts;
    this.now = now;
  }
  private opts: { maxEntries: number; ttlMs: number };
  private readonly now: () => number;

  isFirstAndRemember(sessionId: string | undefined): boolean {
    // No session id → we can't prove a repeat, so treat as first-seen (COLD).
    // Returning false here would make the COLD label permanently unreachable.
    if (sessionId === undefined) return true;
    const t = this.now();
    const prev = this.seen.get(sessionId);
    const fresh = prev !== undefined && t - prev < this.opts.ttlMs;
    // delete-then-set so re-insertion moves the key to the end (true LRU
    // recency); a long-lived active session is no longer the first evicted.
    if (prev !== undefined) {
      this.seen.delete(sessionId);
    } else if (this.seen.size >= this.opts.maxEntries) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.seen.set(sessionId, t);
    return !fresh;
  }

  /** Apply a reloaded capacity/TTL WITHOUT discarding remembered sessions —
   * a shrunken capacity evicts the oldest entries; a grown capacity is a
   * no-op; a TTL change takes effect on the next freshness check. Rebuilding
   * the tracker on every reload would wipe the map and misclassify the next
   * active request as COLD. */
  applyConfig(opts: { maxEntries: number; ttlMs: number }): void {
    this.opts = opts;
    while (this.seen.size > opts.maxEntries) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
  }
}
