import { createMiddleware } from 'hono/factory';
import { logger, withReq } from '../../logger.js';
import { dumpEnabled, dumpRequest } from '../body-dump.js';
import { buildUpstreamResponseWithLogging } from '../cache-logging.js';
import type { ProxyEnv } from '../context.js';
import { buildResponseHeaders } from '../headers.js';
import { classifyRequestType } from '../observability/classify.js';
import { extractFromFullText } from '../observability/extract.js';
import type { Extracted, RequestContext } from '../observability/types.js';
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
): Promise<{ response: Response; extracted: Extracted }> {
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
  const response =
    ctx.method === 'HEAD'
      ? new Response(null, { status: upstream.status, headers: responseHeaders })
      : new Response(bodyText, { status: upstream.status, headers: responseHeaders });
  // Some providers return a usage object inside 4xx/5xx error bodies — preserve it
  // instead of collapsing every error response to NOUSAGE.
  const extracted = extractFromFullText(bodyText, false);
  return { response, extracted };
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

  // dumpRequest writes the request half of the dump and returns its file path;
  // threading it through reqCtx lets the DumpSink enrich that exact file later
  // without a reqId→path lookup (reqId is only 32 bits, so such a map collides).
  const dumpPath = dumpEnabled()
    ? dumpRequest({ reqId, method, path, model: c.var.modelName, forwardBody })
    : undefined;

  // Request context for observability — computed once, before the fetch, so
  // every termination path (success, HTTP error, client abort, network
  // failure) can observe and no request dump is left orphaned.
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
    dumpPath,
  };
  const observability = c.var.observability;

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
    // Pre-response failure (client abort → 499, upstream unreachable → 502):
    // observe so the dump isn't orphaned and the attempt is recorded. No
    // response body is available → collapses to NOUSAGE.
    const response = buildErrorResponse(err, ctx);
    observability.observe(reqCtx, {}, response.status);
    return response;
  } finally {
    c.req.raw.signal.removeEventListener('abort', onClientAbort);
  }

  if (upstream.status >= 400) {
    // Observe error responses too — extract usage from the error body so a
    // failed attempt that still reports cache tokens isn't forced to NOUSAGE.
    // The body read is guarded: if it throws (upstream dropped mid-error-body),
    // we still observe with an empty extraction and return the real upstream
    // status — never a synthetic proxy 500, never an orphaned dump.
    let extracted: Extracted = {};
    let response: Response;
    try {
      ({ response, extracted } = await buildUpstreamErrorResponse(upstream, ctx));
    } catch {
      logger.debug(
        withReq(
          reqId,
          `upstream ${upstream.status} error body unreadable; observing without detail`,
        ),
      );
      response = new Response(null, {
        status: upstream.status,
        headers: buildResponseHeaders(upstream.headers),
      });
    }
    observability.observe(reqCtx, extracted, upstream.status);
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
