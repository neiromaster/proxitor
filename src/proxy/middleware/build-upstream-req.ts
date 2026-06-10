import { createMiddleware } from 'hono/factory';
import { logger, withReq } from '../../logger.js';
import { formatAuthHeader } from '../../utils.js';
import type { ProxyEnv } from '../context.js';
import { filterHeaders, STRIP_REQUEST } from '../headers.js';

const PROTO_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function resolveForwardBody(c: {
  var: {
    reqId: string;
    bodyMutated: boolean;
    parsedBody: unknown;
    rawBody: ArrayBuffer | undefined;
  };
}): ArrayBuffer | undefined {
  if (c.var.bodyMutated && c.var.parsedBody) {
    try {
      return new TextEncoder().encode(JSON.stringify(c.var.parsedBody))
        .buffer as ArrayBuffer;
    } catch (err) {
      // Body mutation produced a non-serializable value (BigInt, circular
      // reference, etc.). Fall back to forwarding the raw body unchanged so
      // the request still reaches the upstream — the same behavior the old
      // `resolveRequest` had for body-processing failures.
      logger.warn(
        withReq(
          c.var.reqId,
          `Failed to re-serialize mutated body (${err instanceof Error ? err.message : 'unknown'}); forwarding raw body as-is`,
        ),
      );
      return c.var.rawBody;
    }
  }
  return c.var.rawBody;
}

function applyProxyHeaders(
  headers: Record<string, string>,
  config: {
    openrouterKey: string;
    authType: 'bearer' | 'oauth';
    attributionReferer: string;
    attributionTitle: string;
  },
): void {
  headers.Authorization = formatAuthHeader(config.openrouterKey, config.authType);
  headers['HTTP-Referer'] = config.attributionReferer;
  headers['X-OpenRouter-Title'] = config.attributionTitle;
  headers['Accept-Encoding'] = 'identity';
}

function applyExtraHeaders(
  headers: Record<string, string>,
  extraHeaders: Record<string, string> | undefined,
): void {
  if (!extraHeaders) return;
  // Iterate with Object.entries + skip dangerous keys to avoid
  // prototype pollution: `Object.assign` would copy `__proto__`,
  // `constructor`, and `prototype` from a user-controlled config
  // (modelOverrides[pattern].headers comes from YAML) onto the
  // request-headers object, poisoning its prototype chain.
  for (const [key, value] of Object.entries(extraHeaders)) {
    if (PROTO_POLLUTION_KEYS.has(key)) continue;
    headers[key] = value;
  }
}

function forceJsonContentType(headers: Record<string, string>): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'content-type') delete headers[key];
  }
  headers['Content-Type'] = 'application/json';
}

export const buildUpstreamReq = createMiddleware<ProxyEnv>(async (c, next) => {
  c.set('forwardBody', resolveForwardBody(c));

  const headers = filterHeaders(c.req.raw.headers, STRIP_REQUEST);
  applyProxyHeaders(headers, c.var.config);
  applyExtraHeaders(headers, c.var.resolvedConfig.headers);

  if (c.var.effectiveSessionId !== undefined) {
    delete headers['x-claude-code-session-id'];
    delete headers['x-session-id'];
    headers['x-session-id'] = c.var.effectiveSessionId;
  }

  if (c.var.bodyMutated) {
    forceJsonContentType(headers);
  }

  c.set('upstreamHeaders', headers);

  await next();
});
