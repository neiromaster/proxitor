import type { ObservabilityConfig } from '../../config-schema.js';
import { logger, withReq } from '../../logger.js';
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

  /** Classify and dispatch one observation to every sink. Never throws: the
   * response pipeline calls this on many termination paths, so a failure must
   * degrade to a debug log, not escape to the client. */
  observe(
    req: RequestContext,
    extracted: { usage?: ExtractedUsage; routing?: RoutingMetadata },
    status: number,
  ): void {
    try {
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
        dumpPath: req.dumpPath,
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
      // Isolate sinks: one throwing sink must not kill the rest for this observation.
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
    } catch (err) {
      logger.debug(
        withReq(
          req.reqId,
          `Observability observe failed: ${err instanceof Error ? err.message : err}`,
        ),
      );
    }
  }

  /** Apply a hot-reloaded config in place — must not discard remembered
   * sessions, or an unrelated reload misclassifies the next request as COLD. */
  reconfigure(config: { observability: ObservabilityRuntimeConfig }): void {
    const o = config.observability;
    this.hitThresholdPct = o.hitThreshold;
    this.tracker.applyConfig({
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
  // DumpSink is always wired; both it and dumpRequest re-check dumpEnabled()
  // per call, so a flag flip after startup doesn't orphan later request dumps.
  const built: ObservationSink[] = [new LiveLineSink(), new DumpSink()];
  return new Observability(tracker, sinks ?? built, o.hitThreshold);
}
