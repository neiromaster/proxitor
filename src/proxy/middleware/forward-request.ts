import { createMiddleware } from 'hono/factory';
import { logger, withReq } from '../../logger.js';
import { buildUpstreamResponseWithLogging } from '../cache-logging.js';
import type { ProxyEnv } from '../context.js';
import { buildResponseHeaders } from '../headers.js';
import { extractErrorDetail } from '../utils/error.js';

type Ctx = {
  reqId: string;
  method: string;
  path: string;
  startedAt: number;
  upstreamShort: string;
  modelLog: string;
  bodyMutated: boolean;
};

function buildErrorResponse(
  err: unknown,
  ctx: Pick<Ctx, 'reqId' | 'method' | 'path'>,
): Response {
  if (err instanceof TypeError) {
    // Network-level failures (ECONNREFUSED, DNS, connection reset) — undici
    // wraps these in TypeError. Return 502 Bad Gateway per the documented
    // proxy_upstream_error contract.
    logger.error(withReq(ctx.reqId, 'Upstream fetch error:'), err);
    return Response.json(
      {
        error: {
          message: 'Proxy failed to reach upstream',
          type: 'proxy_upstream_error',
        },
      },
      { status: 502 },
    );
  }
  // AbortError from client cancellation: the client is gone, so 499 (client
  // closed request) is more accurate than 500.
  if (err instanceof DOMException && err.name === 'AbortError') {
    logger.warn(withReq(ctx.reqId, `Aborted: ${ctx.method} ${ctx.path}`));
    return new Response(null, { status: 499 });
  }
  throw err;
}

async function buildUpstreamErrorResponse(
  upstream: Response,
  ctx: Ctx,
): Promise<Response> {
  const bodyText = await upstream.text();
  const detail = extractErrorDetail(bodyText);
  const truncated = detail.length > 300 ? `${detail.slice(0, 300)}…` : detail;
  const logFn = upstream.status >= 500 ? logger.error : logger.warn;

  logFn(
    withReq(
      ctx.reqId,
      `${ctx.method} ${ctx.path} ← ${upstream.status} (${Date.now() - ctx.startedAt}ms): ${truncated}`,
    ),
  );

  const responseHeaders = buildResponseHeaders(upstream.headers);
  if (ctx.method === 'HEAD') {
    return new Response(null, { status: upstream.status, headers: responseHeaders });
  }
  return new Response(bodyText, { status: upstream.status, headers: responseHeaders });
}

export const forwardRequest = createMiddleware<ProxyEnv>(async c => {
  const { upstreamUrl, forwardBody, upstreamHeaders, reqId, path, startedAt, method } =
    c.var;

  const ctx: Ctx = {
    reqId,
    method,
    path,
    startedAt,
    upstreamShort: upstreamUrl.replace(/^https?:\/\//, ''),
    modelLog: c.var.modelName ? ` model=${c.var.modelName}` : '',
    bodyMutated: c.var.bodyMutated,
  };

  const controller = new AbortController();
  const onClientAbort = () => controller.abort();
  c.req.raw.signal.addEventListener('abort', onClientAbort);

  logger.info(
    withReq(
      reqId,
      `${method} ${path} → ${ctx.upstreamShort}${ctx.bodyMutated ? ' [inject]' : ''}${ctx.modelLog}`,
    ),
  );

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method,
      headers: upstreamHeaders,
      body: forwardBody,
      signal: controller.signal,
      ...(forwardBody ? { duplex: 'half' as const } : {}),
    });
  } catch (err) {
    return buildErrorResponse(err, ctx);
  } finally {
    c.req.raw.signal.removeEventListener('abort', onClientAbort);
  }

  if (upstream.status >= 400) {
    return buildUpstreamErrorResponse(upstream, ctx);
  }

  logger.info(
    withReq(
      reqId,
      `${method} ${path} ← ${upstream.status} (${Date.now() - startedAt}ms)`,
    ),
  );

  return buildUpstreamResponseWithLogging(upstream, method, reqId);
});
