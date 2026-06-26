// src/proxy/observability/sinks.ts

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
  // model may be empty for non-model routes (e.g. the catch-all); omit it
  // rather than emit a stray empty token that breaks whitespace-delimited logs.
  if (obs.model) parts.push(obs.model);
  parts.push(`[${obs.requestType}]`);
  return withReq(obs.reqId, parts.join('  '));
}

export class LiveLineSink implements ObservationSink {
  // Resolved at emit time, not construction, so a stdout redirection or TTY
  // attachment after startup is honored (avoids leaking ANSI into piped files).
  private readonly useColor: () => boolean;
  constructor(useColor: () => boolean = () => process.stdout.isTTY === true) {
    this.useColor = useColor;
  }
  emit(obs: CacheObservation): void {
    logger.info(formatLine(obs, this.useColor()));
  }
}

/** Enriches the request dump file with the classified response observation.
 * The read+write is async (libuv thread pool) and fire-and-forget, so a dump
 * can't block other in-flight responses on the streaming finalize path. A
 * small concurrency cap prevents a burst of responses from saturating the
 * thread pool with dozens of simultaneous fs operations. */
export type DumpSinkDeps = {
  maxConcurrent?: number;
  /** Upper bound on the waiter queue. Beyond it a dump is dropped (best-effort)
   * so a sustained burst of slowly-streaming responses that fs-enrich slower
   * than they finalize can't grow the queue without limit. */
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
    // Gate per-call (not at construction) so a flag flip after startup stays
    // consistent with dumpRequest — and stays a cheap no-op when dumping is off.
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
    // Queue full — drop the dump and log so the loss is observable. Dumping is
    // best-effort; bounding the queue protects memory under a sustained burst.
    else logger.debug(withReq(obs.reqId, 'DumpSink queue full — dump dropped'));
  }
}
