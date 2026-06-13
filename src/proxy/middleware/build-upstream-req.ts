import { createMiddleware } from 'hono/factory';
import { logger, withReq } from '../../logger.js';
import { formatAuthHeader } from '../../utils.js';
import type { ProxyEnv } from '../context.js';
import { filterHeaders, lowercaseKeys, STRIP_REQUEST } from '../headers.js';

const encoder = new TextEncoder();

const PROTO_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function resolveForwardBody(opts: {
  reqId: string;
  bodyMutated: boolean;
  parsedBody: unknown;
  rawBody: ArrayBuffer | undefined;
}): ArrayBuffer | undefined {
  if (opts.bodyMutated && opts.parsedBody) {
    try {
      return encoder.encode(JSON.stringify(opts.parsedBody)).buffer as ArrayBuffer;
    } catch (err) {
      // Non-serializable mutated body; forward raw body as-is.
      logger.warn(
        withReq(
          opts.reqId,
          `Failed to re-serialize mutated body (${err instanceof Error ? err.message : 'unknown'}); forwarding raw body as-is`,
        ),
      );
      return opts.rawBody;
    }
  }
  return opts.rawBody;
}

function proxyHeaders(config: {
  openrouterKey: string;
  authType: 'bearer' | 'oauth';
  attributionReferer: string;
  attributionTitle: string;
}): Record<string, string> {
  return {
    Authorization: formatAuthHeader(config.openrouterKey, config.authType),
    'HTTP-Referer': config.attributionReferer,
    'X-OpenRouter-Title': config.attributionTitle,
    'Accept-Encoding': 'identity',
  };
}

function sanitizeExtraHeaders(
  extraHeaders: Record<string, string> | undefined,
): Record<string, string> {
  const safe: Record<string, string> = {};
  if (!extraHeaders) return safe;
  // Skip prototype-pollution keys from user-controlled YAML config.
  for (const [key, value] of Object.entries(extraHeaders)) {
    if (PROTO_POLLUTION_KEYS.has(key)) continue;
    safe[key] = value;
  }
  return safe;
}

function withSessionId(
  headers: Record<string, string>,
  sessionId: string,
): Record<string, string> {
  const { 'x-claude-code-session-id': _omit, ...rest } = headers;
  return { ...rest, 'x-session-id': sessionId };
}

function withJsonContentType(headers: Record<string, string>): Record<string, string> {
  return { ...headers, 'content-type': 'application/json' };
}

export const buildUpstreamReq = createMiddleware<ProxyEnv>(async (c, next) => {
  c.set(
    'forwardBody',
    resolveForwardBody({
      reqId: c.var.reqId,
      bodyMutated: c.var.bodyMutated,
      parsedBody: c.var.parsedBody,
      rawBody: c.var.rawBody,
    }),
  );

  // Canonicalize to lowercase keys so case-variant headers (e.g. a user-config
  // "Content-Type") can never coexist with their lowercase form and corrupt the
  // merged record. HTTP header names are case-insensitive (RFC 9110 §5.1).
  let headers = lowercaseKeys({
    ...filterHeaders(c.req.raw.headers, STRIP_REQUEST),
    ...proxyHeaders(c.var.config),
    ...sanitizeExtraHeaders(c.var.resolvedConfig.headers),
  });

  if (c.var.effectiveSessionId !== undefined) {
    headers = withSessionId(headers, c.var.effectiveSessionId);
  }

  if (c.var.bodyMutated) {
    headers = withJsonContentType(headers);
  }

  c.set('upstreamHeaders', headers);

  await next();
});
