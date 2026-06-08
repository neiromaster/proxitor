import { createMiddleware } from 'hono/factory';
import { logger, withReq } from '../../logger.js';
import { buildUpstreamResponseWithLogging } from '../cache-logging.js';
import type { ProxyEnv } from '../context.js';
import { buildResponseHeaders } from '../headers.js';
import { extractErrorDetail } from '../utils/error.js';

function handleAbortError(
  err: unknown,
  clientSignal: AbortSignal,
  reqId: string,
  method: string,
  path: string,
): Response | null {
  if (!(err instanceof DOMException) || err.name !== 'AbortError') return null;

  const isTimeout = !clientSignal.aborted;
  if (isTimeout) {
    return Response.json(
      {
        error: {
          message: 'Upstream request timed out',
          type: 'proxy_upstream_timeout',
        },
      },
      { status: 504 },
    );
  }
  logger.warn(withReq(reqId, `Aborted: ${method} ${path}`));
  return new Response(null, { status: 499 });
}

export const forwardRequest = createMiddleware<ProxyEnv>(async c => {
  const { upstreamUrl, forwardBody, upstreamHeaders, reqId, path, startedAt, method } =
    c.var;

  const timeoutMs = c.var.config.upstreamTimeoutMs;
  const controller = new AbortController();
  const onClientAbort = () => controller.abort();
  c.req.raw.signal.addEventListener('abort', onClientAbort);

  const timeoutId = setTimeout(() => {
    logger.warn(
      withReq(reqId, `Upstream timeout after ${timeoutMs}ms: ${method} ${path}`),
    );
    controller.abort();
  }, timeoutMs);

  const upstreamShort = upstreamUrl.replace(/^https?:\/\//, '');
  const modelLog = c.var.modelName ? ` model=${c.var.modelName}` : '';
  logger.info(
    withReq(
      reqId,
      `${method} ${path} → ${upstreamShort}${c.var.bodyMutated ? ' [inject]' : ''}${modelLog}`,
    ),
  );

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method,
      headers: upstreamHeaders,
      body: forwardBody,
      signal: controller.signal,
      duplex: forwardBody ? 'half' : undefined,
    });
  } catch (err) {
    c.req.raw.signal.removeEventListener('abort', onClientAbort);
    clearTimeout(timeoutId);

    const abortResponse = handleAbortError(err, c.req.raw.signal, reqId, method, path);
    if (abortResponse) return abortResponse;

    logger.error(withReq(reqId, 'Upstream fetch error:'), err);
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

  c.req.raw.signal.removeEventListener('abort', onClientAbort);
  clearTimeout(timeoutId);

  if (upstream.status >= 400) {
    const bodyText = await upstream.text();
    const detail = extractErrorDetail(bodyText);
    const truncated = detail.length > 300 ? `${detail.slice(0, 300)}…` : detail;
    const logFn = upstream.status >= 500 ? logger.error : logger.warn;

    logFn(
      withReq(
        reqId,
        `${method} ${path} ← ${upstream.status} (${Date.now() - startedAt}ms): ${truncated}`,
      ),
    );

    const responseHeaders = buildResponseHeaders(upstream.headers);
    if (method === 'HEAD') {
      return new Response(null, { status: upstream.status, headers: responseHeaders });
    }
    return new Response(bodyText, { status: upstream.status, headers: responseHeaders });
  }

  logger.info(
    withReq(
      reqId,
      `${method} ${path} ← ${upstream.status} (${Date.now() - startedAt}ms)`,
    ),
  );

  return buildUpstreamResponseWithLogging(upstream, method, reqId);
});
