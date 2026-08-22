export class SessionTracker {
  private readonly seen = new Map<string, number>(); // sessionId -> lastSeenTs (insertion-ordered)
  constructor(opts: { maxEntries: number; ttlMs: number }, now: () => number = Date.now) {
    this.opts = opts;
    this.now = now;
  }
  private opts: { maxEntries: number; ttlMs: number };
  private readonly now: () => number;

  isFirstAndRemember(sessionId: string | undefined): boolean {
    // No session id → can't prove a repeat, so treat as first-seen (COLD).
    if (sessionId === undefined) return true;
    const t = this.now();
    const prev = this.seen.get(sessionId);
    const fresh = prev !== undefined && t - prev < this.opts.ttlMs;
    // delete-then-set for true LRU recency: a refreshed key moves to the end.
    if (prev !== undefined) {
      this.seen.delete(sessionId);
    } else if (this.seen.size >= this.opts.maxEntries) {
      this.evictOne();
    }
    this.seen.set(sessionId, t);
    return !fresh;
  }

  /** Drop the LRU entry (first by Map order). A refresh moves the key to the
   * end, so iteration order is lastSeen order — the first entry is most stale. */
  private evictOne(): void {
    const oldest = this.seen.keys().next().value;
    if (oldest !== undefined) this.seen.delete(oldest);
  }

  /** Apply a reloaded capacity/TTL without discarding remembered sessions —
   * shrinking evicts LRU entries, growing is a no-op, TTL applies on the next
   * freshness check. Rebuilding would wipe the map and misclassify as COLD. */
  applyConfig(opts: { maxEntries: number; ttlMs: number }): void {
    this.opts = opts;
    while (this.seen.size > opts.maxEntries) {
      this.evictOne();
    }
  }
}
