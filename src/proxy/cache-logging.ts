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
 * Wraps the upstream body so usage/routing is observed once on ANY termination
 * path (clean close, client cancel, upstream error) via finalize() — a bare
 * TransformStream skips flush() on upstream errors, orphaning the dump.
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
  const chunks: Uint8Array[] = []; // non-SSE only: refs shared with the client stream
  let finalized = false;

  const finalize = (): void => {
    if (finalized) return;
    finalized = true;
    try {
      let extracted: Extracted;
      if (accumulator) {
        extracted = accumulator.result();
      } else {
        let text = '';
        for (const c of chunks) text += decoder.decode(c, { stream: true });
        text += decoder.decode(); // flush any trailing multi-byte sequence
        extracted = extractFromFullText(text, false);
      }
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
          else chunks.push(value);
          controller.enqueue(value);
        }
      } catch (err) {
        // Emit the partial observation before propagating the upstream error.
        finalize();
        controller.error(err);
      }
    },
    cancel() {
      // Client cancelled — observe the partial result, then release the reader.
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
    // Forward as-is but still observe once, so the dump completes with NOUSAGE.
    ctx.observability.observe(ctx.reqCtx, {}, upstream.status);
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  const body = createLoggingStream(upstream.body, contentType, upstream.status, ctx);
  return new Response(body, { status: upstream.status, headers });
}
