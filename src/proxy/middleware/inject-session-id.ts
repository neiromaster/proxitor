import { createMiddleware } from 'hono/factory';
import type { ProxyEnv } from '../context.js';
import { deriveSessionId } from './session-id.js';

/**
 * Resolve session ID for sticky routing.
 *
 * Uses only the `x-session-id` header (universal across all OpenRouter endpoints).
 * No body mutation needed — the header is set in buildUpstreamReq.
 */
export const injectSessionId = createMiddleware<ProxyEnv>(async (c, next) => {
  const resolved = c.var.resolvedConfig;
  const mode = resolved.sessionId ?? 'auto';
  const sessionId = deriveSessionId(c.req.raw.headers, mode);

  if (sessionId) {
    c.set('effectiveSessionId', sessionId);
  }

  await next();
});
