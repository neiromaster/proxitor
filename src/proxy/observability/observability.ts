// src/proxy/observability/observability.ts
import type { ObservabilityConfig } from '../../config-schema.js';
import { logger, withReq } from '../../logger.js';
import { dumpEnabled } from '../body-dump.js';
import { classifyCacheOutcome } from './classify.js';
import { SessionTracker } from './session-tracker.js';
import { DumpSink, LiveLineSink, type ObservationSink } from './sinks.js';
import type {
  CacheObservation,
  ExtractedUsage,
  RequestContext,
  RoutingMetadata,
} from './types.js';

/** Runtime subset of the schema-derived ObservabilityConfig this module consumes. */
export type ObservabilityRuntimeConfig = Pick<
  ObservabilityConfig,
  'hitThreshold' | 'sessionMaxEntries' | 'sessionTtlMs'
>;

export class Observability {
  private tracker: SessionTracker;
  private readonly sinks: ObservationSink[];
  private hitThresholdPct: number;

  constructor(
    tracker: SessionTracker,
    sinks: ObservationSink[],
    hitThresholdPct: number,
  ) {
    this.tracker = tracker;
    this.sinks = sinks;
    this.hitThresholdPct = hitThresholdPct;
  }

  observe(
    req: RequestContext,
    extracted: { usage?: ExtractedUsage; routing?: RoutingMetadata },
    status: number,
  ): void {
    const usage: ExtractedUsage = extracted.usage ?? {
      present: false,
      inputTokens: 0,
      cacheRead: 0,
      cacheCreate: 0,
    };
    const isFirst = this.tracker.isFirstAndRemember(req.sessionId);
    const outcome = classifyCacheOutcome(
      usage,
      { requestType: req.requestType, isFirstForSession: isFirst },
      { hitThresholdPct: this.hitThresholdPct },
    );
    const obs: CacheObservation = {
      reqId: req.reqId,
      status,
      model: req.model,
      sessionId: req.sessionId,
      requestType: req.requestType,
      toolsCount: req.toolsCount,
      usage,
      outcome,
      routing: extracted.routing,
    };
    // Isolate each sink so a throwing sink (e.g. a logger transport failure)
    // doesn't silently kill the remaining sinks for this observation.
    for (const sink of this.sinks) {
      try {
        sink.emit(obs);
      } catch (err) {
        logger.debug(
          withReq(
            obs.reqId,
            `Observability sink failed: ${err instanceof Error ? err.message : err}`,
          ),
        );
      }
    }
  }

  /** Apply a hot-reloaded config: update the hit threshold and rebuild the
   * session tracker (capacity/TTL). Called by the config-source subscriber. */
  reconfigure(config: { observability: ObservabilityRuntimeConfig }): void {
    const o = config.observability;
    this.hitThresholdPct = o.hitThreshold;
    this.tracker = new SessionTracker({
      maxEntries: o.sessionMaxEntries,
      ttlMs: o.sessionTtlMs,
    });
  }
}

export function createObservability(
  config: { observability: ObservabilityRuntimeConfig },
  sinks?: ObservationSink[],
): Observability {
  const o = config.observability;
  const tracker = new SessionTracker({
    maxEntries: o.sessionMaxEntries,
    ttlMs: o.sessionTtlMs,
  });
  const built: ObservationSink[] = [new LiveLineSink()];
  if (dumpEnabled()) built.push(new DumpSink());
  return new Observability(tracker, sinks ?? built, o.hitThreshold);
}
