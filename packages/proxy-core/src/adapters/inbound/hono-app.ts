import { ENDPOINT_PATHS } from '@proxitor/plugin-api';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import type {
  PipelineRequest,
  PipelineResponse,
  ProxyPipeline,
} from '../../application/proxy-pipeline.js';

const CHAT_PATHS: ReadonlySet<string> = new Set([
  ENDPOINT_PATHS['anthropic-messages'],
  ENDPOINT_PATHS['openai-chat'],
]);

/** Openai wire-error shape for pre-pipeline failures (D5: format unknowable before decode). */
function openaiError(
  status: number,
  message: string,
  extraHeaders?: Record<string, string>,
): Response {
  return Response.json(
    { error: { message, type: 'invalid_request_error' } },
    { status, headers: { 'content-type': 'application/json', ...extraHeaders } },
  );
}

/** D-M5a-1: HTTP method semantics live in the adapter, not the pipeline. */
export function createProxyApp(deps: {
  pipeline: ProxyPipeline;
  bodyLimitBytes: number;
}): Hono {
  const app = new Hono();

  app.use(
    '*',
    bodyLimit({
      maxSize: deps.bodyLimitBytes,
      onError: () => {
        const res = openaiError(
          413,
          `request body exceeds limit (${deps.bodyLimitBytes} bytes)`,
        );
        throw new HTTPException(413, { res });
      },
    }),
  );

  app.all('/v1/*', async c => {
    const path = c.req.path;
    const method = c.req.method;

    if (CHAT_PATHS.has(path) && method !== 'POST') {
      return openaiError(405, `${path} supports POST only`, { allow: 'POST' });
    }
    if (path === '/v1/models' && method !== 'GET') {
      return openaiError(405, `${path} supports GET only`, { allow: 'GET' });
    }
    if (method !== 'POST' && method !== 'GET') {
      return openaiError(404, `unknown path '${path}'`);
    }

    const headers: Record<string, string> = {};
    for (const [name, value] of c.req.raw.headers.entries()) {
      headers[name.toLowerCase()] = value;
    }
    const request: PipelineRequest = {
      path,
      method: method === 'GET' ? 'GET' : 'POST',
      headers,
      body: method === 'GET' ? '' : await c.req.text(),
    };
    const response = await deps.pipeline.handle(request);
    return toStreamingResponse(response, c.req.raw.signal);
  });

  app.notFound(c => openaiError(404, `unknown path '${c.req.path}'`));
  return app;
}

const ENCODER = new TextEncoder();

/**
 * D-M5a-2/D-M5a-10: every pipeline body streams through a web ReadableStream.
 * Client disconnect (stream cancel, or raw.signal during a pull) returns the
 * iterator — its finally aborts the upstream fetch.
 */
export function toStreamingResponse(pr: PipelineResponse, signal: AbortSignal): Response {
  const iterator = pr.body[Symbol.asyncIterator]();
  const disconnected = new Promise<'disconnected'>(resolve => {
    if (signal.aborted) {
      resolve('disconnected');
      return;
    }
    signal.addEventListener('abort', () => resolve('disconnected'), { once: true });
  });
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (closed || signal.aborted) {
        if (!closed) {
          closed = true;
          await iterator.return?.();
        }
        controller.close();
        return;
      }
      const next = await Promise.race([iterator.next(), disconnected]);
      if (next === 'disconnected' || next.done) {
        closed = true;
        controller.close();
        await iterator.return?.();
        return;
      }
      controller.enqueue(ENCODER.encode(next.value));
    },
    async cancel() {
      closed = true;
      await iterator.return?.();
    },
  });
  return new Response(body, { status: pr.status, headers: { ...pr.headers } });
}
