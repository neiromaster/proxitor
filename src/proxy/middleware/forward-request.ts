import { createMiddleware } from 'hono/factory';
import { logger, withReq } from '../../logger.js';
import { dumpEnabled, dumpRequest } from '../body-dump.js';
import { buildUpstreamResponseWithLogging } from '../cache-logging.js';
import type { ProxyEnv } from '../context.js';
import { buildResponseHeaders } from '../headers.js';
import { classifyRequestType } from '../observability/classify.js';
import type { RequestContext } from '../observability/types.js';
import { extractErrorDetail } from '../utils/error.js';

const DUPLEX_HALF = { duplex: 'half' as const };

type Ctx = {
  reqId: string;
  method: string;
  path: string;
  startedAt: number;
  bodyMutated: boolean;
};

function buildErrorResponse(
  err: unknown,
  ctx: Pick<Ctx, 'reqId' | 'method' | 'path'>,
): Response {
  if (err instanceof TypeError) {
    // Network failures (undici TypeError) → 502.
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
  // Client disconnected → 499.
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
    bodyMutated: c.var.bodyMutated,
  };

  const controller = new AbortController();
  const onClientAbort = () => controller.abort();
  c.req.raw.signal.addEventListener('abort', onClientAbort);

  const upstreamShort = upstreamUrl.replace(/^https?:\/\//, '');
  const modelLog = c.var.modelName ? ` model=${c.var.modelName}` : '';

  logger.info(
    withReq(
      reqId,
      `${method} ${path} → ${upstreamShort}${ctx.bodyMutated ? ' [inject]' : ''}${modelLog}`,
    ),
  );

  if (dumpEnabled()) {
    dumpRequest({ reqId, method, path, model: c.var.modelName, forwardBody });
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method,
      headers: upstreamHeaders,
      body: forwardBody,
      signal: controller.signal,
      ...(forwardBody ? DUPLEX_HALF : {}),
    });
  } catch (err) {
    return buildErrorResponse(err, ctx);
  } finally {
    c.req.raw.signal.removeEventListener('abort', onClientAbort);
  }

  // Request context for observability — computed once and shared by the
  // success and error paths so every proxied response is observed.
  const parsedBody = c.var.parsedBody;
  const toolsCount = Array.isArray(parsedBody?.tools) ? parsedBody.tools.length : 0;
  // Chat Completions uses max_tokens/max_completion_tokens; the Responses API
  // uses max_output_tokens — resolve across all three so /v1/responses side
  // calls classify correctly instead of defaulting to [main].
  const maxTokens =
    parsedBody?.max_tokens ??
    parsedBody?.max_completion_tokens ??
    parsedBody?.max_output_tokens;
  const requestType = classifyRequestType(
    { toolsCount, maxTokens },
    { sideMaxTokens: c.var.config.observability.sideMaxTokens },
  );
  const reqCtx: RequestContext = {
    reqId,
    model: c.var.modelName ?? '',
    sessionId: c.var.effectiveSessionId,
    toolsCount,
    maxTokens,
    requestType,
  };
  const observability = c.var.observability;

  if (upstream.status >= 400) {
    const response = await buildUpstreamErrorResponse(upstream, ctx);
    // Observe error responses too: avoids orphaned request dumps (dumpRequest
    // already ran) and records the failed attempt in the session tracker.
    // No usage is parsed from error bodies → collapses to NOUSAGE.
    observability.observe(reqCtx, {}, upstream.status);
    return response;
  }

  logger.info(
    withReq(
      reqId,
      `${method} ${path} ← ${upstream.status} (${Date.now() - startedAt}ms)`,
    ),
  );

  return buildUpstreamResponseWithLogging(upstream, method, { reqCtx, observability });
});
