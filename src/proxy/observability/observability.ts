// src/proxy/observability/observability.ts
import { classifyCacheOutcome } from './classify.js';
import { SessionTracker } from './session-tracker.js';
import { LiveLineSink, type ObservationSink } from './sinks.js';
import type {
  CacheObservation,
  ExtractedUsage,
  RequestContext,
  RoutingMetadata,
} from './types.js';

export type ObservabilityConfig = {
  hitThreshold: number;
  sessionMaxEntries: number;
  sessionTtlMs: number;
};

export class Observability {
  private readonly tracker: SessionTracker;
  private readonly sinks: ObservationSink[];
  private readonly hitThresholdPct: number;

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
    for (const sink of this.sinks) sink.emit(obs);
  }
}

export function createObservability(
  config: { observability: ObservabilityConfig },
  sinks?: ObservationSink[],
): Observability {
  const o = config.observability;
  const tracker = new SessionTracker({
    maxEntries: o.sessionMaxEntries,
    ttlMs: o.sessionTtlMs,
  });
  return new Observability(tracker, sinks ?? [new LiveLineSink()], o.hitThreshold);
}
