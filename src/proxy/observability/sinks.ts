import { logger, withReq } from '../../logger.js';
import { dumpEnabled, dumpResponse } from '../body-dump.js';
import type { CacheLabel, CacheObservation } from './types.js';

export type ObservationSink = {
  emit(obs: CacheObservation): void;
};

const wrap = (code: string) => (s: string) => `\x1b[${code}m${s}\x1b[0m`;
const PAINT: Record<CacheLabel, (s: string) => string> = {
  HIT: wrap('32'),
  PARTIAL: wrap('33'),
  MISS: wrap('31'),
  COLD: wrap('2'),
  NOUSAGE: wrap('90'),
};

export function colorizeLabel(label: CacheLabel, useColor: boolean): string {
  return useColor ? PAINT[label](label) : label;
}

export function formatLine(obs: CacheObservation, useColor = false): string {
  const { label, hitPct } = obs.outcome;
  const parts: string[] = [colorizeLabel(label, useColor)];
  if (label === 'HIT' || label === 'PARTIAL') parts.push(`${hitPct.toFixed(0)}%`);
  if (obs.usage.cacheRead > 0) parts.push(`read ${obs.usage.cacheRead}`);
  if (obs.usage.cacheCreate > 0) parts.push(`write ${obs.usage.cacheCreate}`);
  if (obs.usage.present) parts.push(`in ${obs.usage.inputTokens}`);
  if (obs.routing) parts.push(`provider=${obs.routing.provider}`);
  // Omit an empty model (non-model routes) — a stray token breaks log parsing.
  if (obs.model) parts.push(obs.model);
  parts.push(`[${obs.requestType}]`);
  return withReq(obs.reqId, parts.join('  '));
}

export class LiveLineSink implements ObservationSink {
  // Resolve at emit time so a redirection/TTY change after startup is honored.
  private readonly useColor: () => boolean;
  constructor(useColor: () => boolean = () => process.stdout.isTTY === true) {
    this.useColor = useColor;
  }
  emit(obs: CacheObservation): void {
    logger.info(formatLine(obs, this.useColor()));
  }
}

/** Enriches the request dump with the response observation. Fire-and-forget
 * with a concurrency cap so a burst of responses can't saturate the fs thread
 * pool and stall the streaming finalize path. */
export type DumpSinkDeps = {
  maxConcurrent?: number;
  /** Upper bound on the waiter queue; beyond it a dump is dropped so a burst
   * can't grow the queue without limit. */
  maxWaiters?: number;
  /** Injectable async work + gate so the queue cap is unit-testable without fs. */
  dump?: (obs: CacheObservation) => Promise<void>;
  enabled?: () => boolean;
};

export class DumpSink implements ObservationSink {
  private inflight = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly maxConcurrent: number;
  private readonly maxWaiters: number;
  private readonly dump: (obs: CacheObservation) => Promise<void>;
  private readonly enabled: () => boolean;

  constructor(deps: DumpSinkDeps = {}) {
    this.maxConcurrent = deps.maxConcurrent ?? 16;
    this.maxWaiters = deps.maxWaiters ?? 256;
    this.dump = deps.dump ?? dumpResponse;
    this.enabled = deps.enabled ?? dumpEnabled;
  }

  emit(obs: CacheObservation): void {
    // Gate per-call so a flag flip stays consistent with dumpRequest.
    if (!this.enabled()) return;
    const run = (): void => {
      this.inflight += 1;
      void this.dump(obs)
        .catch(err => {
          logger.debug(
            withReq(
              obs.reqId,
              `DumpSink failed: ${err instanceof Error ? err.message : err}`,
            ),
          );
        })
        .finally(() => {
          this.inflight -= 1;
          const next = this.waiters.shift();
          if (next) next();
        });
    };
    if (this.inflight < this.maxConcurrent) run();
    else if (this.waiters.length < this.maxWaiters) this.waiters.push(run);
    // Queue full — drop the dump (best-effort) and log the loss.
    else logger.debug(withReq(obs.reqId, 'DumpSink queue full — dump dropped'));
  }
}
