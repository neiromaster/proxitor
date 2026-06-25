// src/proxy/observability/session-tracker.ts
export class SessionTracker {
  private readonly seen = new Map<string, number>(); // sessionId -> lastSeenTs (insertion-ordered)
  constructor(opts: { maxEntries: number; ttlMs: number }, now: () => number = Date.now) {
    this.opts = opts;
    this.now = now;
  }
  private readonly opts: { maxEntries: number; ttlMs: number };
  private readonly now: () => number;

  isFirstAndRemember(sessionId: string | undefined): boolean {
    if (sessionId === undefined) return false;
    const t = this.now();
    const prev = this.seen.get(sessionId);
    if (prev !== undefined && t - prev < this.opts.ttlMs) {
      this.seen.set(sessionId, t); // refresh timestamp, keep order
      return false;
    }
    if (!this.seen.has(sessionId) && this.seen.size >= this.opts.maxEntries) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.seen.set(sessionId, t);
    return true;
  }
}
