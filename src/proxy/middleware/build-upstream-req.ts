import { createMiddleware } from 'hono/factory';
import { logger, withReq } from '../../logger.js';
import { formatAuthHeader } from '../../utils.js';
import type { ProxyEnv } from '../context.js';
import { filterHeaders, STRIP_REQUEST } from '../headers.js';

export const buildUpstreamReq = createMiddleware<ProxyEnv>(async (c, next) => {
  const config = c.var.config;

  if (c.var.bodyMutated && c.var.parsedBody) {
    try {
      c.set(
        'forwardBody',
        new TextEncoder().encode(JSON.stringify(c.var.parsedBody)).buffer as ArrayBuffer,
      );
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
      c.set('forwardBody', c.var.rawBody);
      c.set('bodyMutated', false);
    }
  } else if (c.var.rawBody) {
    c.set('forwardBody', c.var.rawBody);
  } else {
    c.set('forwardBody', undefined);
  }

  const headers = filterHeaders(c.req.raw.headers, STRIP_REQUEST);

  headers.Authorization = formatAuthHeader(config.openrouterKey, config.authType);
  headers['HTTP-Referer'] = config.attributionReferer;
  headers['X-OpenRouter-Title'] = config.attributionTitle;
  headers['Accept-Encoding'] = 'identity';

  const extraHeaders = c.var.resolvedConfig.headers;
  if (extraHeaders) {
    // Iterate with Object.entries + skip dangerous keys to avoid
    // prototype pollution: `Object.assign` would copy `__proto__`,
    // `constructor`, and `prototype` from a user-controlled config
    // (modelOverrides[pattern].headers comes from YAML) onto the
    // request-headers object, poisoning its prototype chain.
    for (const [key, value] of Object.entries(extraHeaders)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      headers[key] = value;
    }
  }

  if (c.var.effectiveSessionId !== undefined) {
    headers['x-session-id'] = c.var.effectiveSessionId;
  }

  if (c.var.bodyMutated) {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-type') delete headers[key];
    }
    headers['Content-Type'] = 'application/json';
  }

  c.set('upstreamHeaders', headers);

  await next();
});
