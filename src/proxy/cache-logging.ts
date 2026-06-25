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

function createLoggingStream(
  contentType: string,
  status: number,
  ctx: LoggingContext,
): TransformStream<Uint8Array, Uint8Array> {
  const isSSE = contentType.toLowerCase().includes('text/event-stream');
  const accumulator = isSSE ? new SseUsageAccumulator() : undefined;
  const chunks: Uint8Array[] | null = isSSE ? null : [];
  const decoder = new TextDecoder();

  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      if (accumulator) accumulator.feed(chunk);
      else chunks!.push(chunk);
    },
    flush() {
      try {
        const extracted: Extracted = accumulator
          ? accumulator.result()
          : extractFromFullText(
              `${chunks!.reduce((acc, c) => acc + decoder.decode(c, { stream: true }), '')}${decoder.decode()}`,
              false,
            );
        ctx.observability.observe(ctx.reqCtx, extracted, status);
      } catch (err) {
        logger.debug(
          withReq(
            ctx.reqCtx.reqId,
            `Cache observability failed: ${err instanceof Error ? err.message : err}`,
          ),
        );
      }
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
    return new Response(null, { status: upstream.status, headers });
  }

  const contentType = upstream.headers.get('content-type') ?? '';
  const lower = contentType.toLowerCase();
  const shouldLog =
    lower.includes('application/json') || lower.includes('text/event-stream');

  const body = shouldLog
    ? upstream.body.pipeThrough(createLoggingStream(contentType, upstream.status, ctx))
    : upstream.body;

  return new Response(body, { status: upstream.status, headers });
}
