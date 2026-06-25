// src/proxy/cache-logging.ts

import { logger, withReq } from '../logger.js';
import { buildResponseHeaders } from './headers.js';
import { extractFromFullText, SseUsageAccumulator } from './observability/extract.js';
import type { Observability } from './observability/observability.js';
import type { Extracted, RequestContext } from './observability/types.js';

export type LoggingContext = {
  observability: Observability;
  reqCtx: RequestContext;
};

/**
 * Wraps the upstream body in a ReadableStream that observes usage/routing once,
 * on ANY termination path: clean close, client cancel, OR an upstream body
 * error. A bare TransformStream only runs flush() (clean close) and cancel()
 * (downstream cancel) — an upstream stream error skips BOTH, orphaning the
 * dump and losing the cache line. The manual pump below unifies all three
 * paths through finalize().
 *
 * SSE folds in O(1) via the accumulator; JSON decodes incrementally into a
 * single string (no separate chunk array held alongside the decoded text).
 */
function createLoggingStream(
  source: ReadableStream<Uint8Array>,
  contentType: string,
  status: number,
  ctx: LoggingContext,
): ReadableStream<Uint8Array> {
  const isSSE = contentType.toLowerCase().includes('text/event-stream');
  const accumulator = isSSE ? new SseUsageAccumulator() : undefined;
  const decoder = new TextDecoder();
  let text = ''; // non-SSE: incrementally decoded body
  let finalized = false;

  const finalize = (): void => {
    if (finalized) return;
    finalized = true;
    try {
      const extracted: Extracted = accumulator
        ? accumulator.result()
        : extractFromFullText(`${text}${decoder.decode()}`, false);
      ctx.observability.observe(ctx.reqCtx, extracted, status);
    } catch (err) {
      logger.debug(
        withReq(
          ctx.reqCtx.reqId,
          `Cache observability failed: ${err instanceof Error ? err.message : err}`,
        ),
      );
    }
  };

  const reader = source.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          finalize();
          controller.close();
          return;
        }
        if (value) {
          if (accumulator) accumulator.feed(value);
          else text += decoder.decode(value, { stream: true });
          controller.enqueue(value);
        }
      } catch (err) {
        // Upstream body errored mid-stream — emit the partial observation
        // before propagating the error to the client.
        finalize();
        controller.error(err);
      }
    },
    cancel() {
      // Downstream (client) cancelled — emit the partial observation and
      // release the upstream reader.
      finalize();
      void reader.cancel().catch(() => {
        /* upstream already gone */
      });
    },
  });
}

export function buildUpstreamResponseWithLogging(
  upstream: Response,
  method: string,
  ctx: LoggingContext,
): Response {
  const headers = buildResponseHeaders(upstream.headers);

  if (method === 'HEAD' || !upstream.body) {
    // No body to parse — still observe once so the request dump isn't orphaned.
    ctx.observability.observe(ctx.reqCtx, {}, upstream.status);
    return new Response(null, { status: upstream.status, headers });
  }

  const contentType = upstream.headers.get('content-type') ?? '';
  const lower = contentType.toLowerCase();
  const shouldLog =
    lower.includes('application/json') || lower.includes('text/event-stream');

  if (!shouldLog) {
    // Non-observability content type — forward as-is but still observe once so
    // the dump is completed and a NOUSAGE line is emitted (no usage to parse).
    ctx.observability.observe(ctx.reqCtx, {}, upstream.status);
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  const body = createLoggingStream(upstream.body, contentType, upstream.status, ctx);
  return new Response(body, { status: upstream.status, headers });
}
