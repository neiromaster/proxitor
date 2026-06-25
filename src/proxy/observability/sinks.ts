// src/proxy/observability/sinks.ts

import { logger, withReq } from '../../logger.js';
import { dumpResponse } from '../body-dump.js';
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
  parts.push(obs.model, `[${obs.requestType}]`);
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
 * can't block other in-flight responses on the streaming finalize path. */
export class DumpSink implements ObservationSink {
  emit(obs: CacheObservation): void {
    void dumpResponse(obs).catch(err => {
      logger.debug(
        withReq(
          obs.reqId,
          `DumpSink failed: ${err instanceof Error ? err.message : err}`,
        ),
      );
    });
  }
}
