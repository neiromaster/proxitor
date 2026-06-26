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

export function buildErrorResponse(
  err: unknown,
  ctx: Pick<Ctx, 'reqId' | 'method' | 'path'>,
  observeUnhandled?: () => void,
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
  // Unexpected error — observe (status 500) before re-throwing so the attempt
  // isn't lost from observability and the dump isn't orphaned.
  observeUnhandled?.();
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
  // Some providers include usage in error bodies — preserve it, not NOUSAGE.
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

  // dumpRequest returns the file path; threading it through reqCtx lets the
  // DumpSink enrich that file without a collision-prone reqId→path lookup.
  const dumpPath = dumpEnabled()
    ? dumpRequest({ reqId, method, path, model: c.var.modelName, forwardBody })
    : undefined;

  // Compute once before the fetch so every termination path can observe and no
  // dump is orphaned.
  const parsedBody = c.var.parsedBody;
  const toolsCount = Array.isArray(parsedBody?.tools) ? parsedBody.tools.length : 0;
  // Resolve across max_tokens / max_completion_tokens / max_output_tokens so
  // /v1/responses side calls classify correctly.
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
    // Pre-response failure (abort → 499, unreachable → 502): no body, so the
    // observation collapses to NOUSAGE — observe to avoid an orphaned dump.
    const response = buildErrorResponse(err, ctx, () =>
      observability.observe(reqCtx, {}, 500),
    );
    observability.observe(reqCtx, {}, response.status);
    return response;
  } finally {
    c.req.raw.signal.removeEventListener('abort', onClientAbort);
  }

  if (upstream.status >= 400) {
    // Observe error responses, extracting any usage from the body. The read is
    // guarded: on failure we still observe empty and return the real status —
    // never a synthetic 500, never an orphaned dump.
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
