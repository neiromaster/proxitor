import { createMiddleware } from 'hono/factory';
import { logger, withReq } from '../../logger.js';
import { buildUpstreamResponseWithLogging } from '../cache-logging.js';
import type { ProxyEnv } from '../context.js';
import { buildResponseHeaders } from '../headers.js';

/**
 * OpenRouter error format:
 *   { error: { code, message, metadata: { raw, provider_name } } }
 */
function formatMetadata(meta: Record<string, unknown>): string[] {
  const parts: string[] = [];
  if (meta.provider_name) parts.push(`provider=${meta.provider_name}`);
  if (meta.raw) {
    const raw = typeof meta.raw === 'string' ? meta.raw : JSON.stringify(meta.raw);
    parts.push(raw);
  }
  return parts;
}

export function extractErrorDetail(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText);
    if (typeof parsed !== 'object' || parsed === null) return bodyText;

    const err = parsed.error;
    if (typeof err === 'object' && err !== null && err.message) {
      const parts: string[] = [];
      if (err.code != null) parts.push(String(err.code));
      parts.push(String(err.message));
      if (err.metadata && typeof err.metadata === 'object') {
        parts.push(...formatMetadata(err.metadata as Record<string, unknown>));
      }
      return parts.join(' | ');
    }
    if (parsed.message) return String(parsed.message);
  } catch {
    // non-JSON
  }
  return bodyText;
}

export const forwardRequest = createMiddleware<ProxyEnv>(async c => {
  const { upstreamUrl, forwardBody, upstreamHeaders, reqId, path, startedAt, method } =
    c.var;

  const controller = new AbortController();
  c.req.raw.signal.addEventListener('abort', () => controller.abort());

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
    if (err instanceof DOMException && err.name === 'AbortError') {
      logger.warn(withReq(reqId, `Aborted: ${method} ${path}`));
      return new Response(null, { status: 499 });
    }

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
