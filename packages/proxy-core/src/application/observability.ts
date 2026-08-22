import type {
  CanonicalEvent,
  LoggerPort,
  PartialUsage,
  Usage,
} from '@proxitor/plugin-api';
import type { ObservabilityConfig } from './config-schema.js';
import { classifyCacheOutcome, classifyRequestType } from './observability-classify.js';
import { SessionTracker } from './observability-session.js';

export type CacheLabel = 'HIT' | 'PARTIAL' | 'MISS' | 'COLD' | 'NOUSAGE';
export type RequestType = 'main' | 'side';
export type UsageSnapshot = {
  present: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheCreate: number;
};
export type ObservationRecord = {
  requestId: string;
  status: number;
  model: string;
  provider?: string;
  physicalModel?: string;
  sessionId?: string;
  requestType: RequestType;
  toolsCount: number;
  usage: UsageSnapshot;
  outcome: { label: CacheLabel; hitPct: number };
  requestBody?: unknown;
};
export type ObservationSink = { emit(record: ObservationRecord): void };
export type ObservationContext = {
  requestId: string;
  model: string;
  provider?: string;
  physicalModel?: string;
  sessionId?: string;
  toolsCount: number;
  maxTokens?: number;
};
export type RequestObservation = {
  onEvent(event: CanonicalEvent): void;
  captureOutbound(body: string): void;
  end(status: number): void; // idempotent; never throws
};
export type ObservabilityPort = {
  begin(ctx: ObservationContext): RequestObservation;
  reconfigure(config: ObservabilityConfig): void;
};

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function emitObservation(
  ctx: ObservationContext,
  status: number,
  usage: UsageSnapshot,
  isFirst: boolean,
  requestBody: unknown,
  cfg: ObservabilityConfig,
  sinks: readonly ObservationSink[],
  logger: LoggerPort,
): void {
  try {
    const outcome = classifyCacheOutcome(
      usage,
      {
        requestType: classifyRequestType(ctx, { sideMaxTokens: cfg.sideMaxTokens }),
        isFirstForSession: isFirst,
      },
      { hitThresholdPct: cfg.hitThreshold },
    );
    const record: ObservationRecord = {
      requestId: ctx.requestId,
      status,
      model: ctx.model,
      provider: cfg.routerMetadata ? ctx.provider : undefined,
      physicalModel: cfg.routerMetadata ? ctx.physicalModel : undefined,
      sessionId: ctx.sessionId,
      requestType: outcome.type,
      toolsCount: ctx.toolsCount,
      usage,
      outcome,
      requestBody,
    };
    for (const sink of sinks) {
      try {
        sink.emit(record);
      } catch (err) {
        logger.debug('observability sink failed', { error: messageOf(err) });
      }
    }
  } catch (err) {
    logger.debug('observability observe failed', { error: messageOf(err) });
  }
}

function mergeUsage(target: UsageSnapshot, source: PartialUsage): void {
  if (source.inputTokens !== undefined) target.inputTokens = source.inputTokens;
  if (source.outputTokens !== undefined) target.outputTokens = source.outputTokens;
  if (source.cacheReadTokens !== undefined) target.cacheRead = source.cacheReadTokens;
  if (source.cacheCreateTokens !== undefined)
    target.cacheCreate = source.cacheCreateTokens;
  target.present = true;
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

export function createObservability(deps: {
  config: ObservabilityConfig;
  sinks: readonly ObservationSink[];
  logger: LoggerPort;
  now?: () => number;
  wantsOutboundBody?: () => boolean;
}): ObservabilityPort {
  let cfg = deps.config;
  const tracker = new SessionTracker(
    { maxEntries: cfg.sessionMaxEntries, ttlMs: cfg.sessionTtlMs },
    deps.now,
  );
  const wantsBody = deps.wantsOutboundBody ?? (() => false);
  return {
    begin(ctx) {
      const isFirst = tracker.isFirstAndRemember(ctx.sessionId);
      const usage: UsageSnapshot = {
        present: false,
        inputTokens: 0,
        outputTokens: 0,
        cacheRead: 0,
        cacheCreate: 0,
      };
      let requestBody: unknown;
      let ended = false;
      return {
        onEvent(event) {
          if (event.type === 'usage') {
            const fullUsage: Usage = {
              inputTokens: event.usage.inputTokens ?? 0,
              outputTokens: event.usage.outputTokens ?? 0,
              cacheReadTokens: event.usage.cacheReadTokens,
              cacheCreateTokens: event.usage.cacheCreateTokens,
            };
            mergeUsage(usage, fullUsage);
          } else if (event.type === 'message_delta' && event.usage !== undefined) {
            mergeUsage(usage, event.usage);
          }
        },
        captureOutbound(body) {
          if (wantsBody()) requestBody = parseJson(body);
        },
        end(status) {
          if (ended) return;
          ended = true;
          emitObservation(
            ctx,
            status,
            usage,
            isFirst,
            requestBody,
            cfg,
            deps.sinks,
            deps.logger,
          );
        },
      };
    },
    reconfigure(next) {
      cfg = next;
      tracker.applyConfig({
        maxEntries: next.sessionMaxEntries,
        ttlMs: next.sessionTtlMs,
      });
    },
  };
}
