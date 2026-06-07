import { createMiddleware } from 'hono/factory';
import { formatAuthHeader } from '../../utils.js';
import type { ProxyEnv } from '../context.js';
import { filterHeaders, STRIP_REQUEST } from '../headers.js';

export const buildUpstreamReq = createMiddleware<ProxyEnv>(async (c, next) => {
  const config = c.var.config;

  if (c.var.bodyMutated && c.var.parsedBody) {
    c.set(
      'forwardBody',
      new TextEncoder().encode(JSON.stringify(c.var.parsedBody)).buffer as ArrayBuffer,
    );
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
    Object.assign(headers, extraHeaders);
  }

  if (c.var.effectiveSessionId !== undefined) {
    headers['x-session-id'] = c.var.effectiveSessionId;
  }

  if (c.var.bodyMutated) {
    // Remove any existing content-type passed through from client (case-insensitive)
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-type') {
        delete headers[key];
      }
    }
    headers['Content-Type'] = 'application/json';
  }

  c.set('upstreamHeaders', headers);

  await next();
});
