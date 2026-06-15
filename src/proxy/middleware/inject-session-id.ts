import { createMiddleware } from 'hono/factory';
import type { ProxyEnv } from '../context.js';
import { deriveSessionId } from '../utils/session-id.js';

export const injectSessionId = createMiddleware<ProxyEnv>(async (c, next) => {
  const resolved = c.var.resolvedConfig;
  const mode = resolved.sessionId;
  const sessionId = deriveSessionId(
    c.req.raw.headers,
    c.var.parsedBody,
    c.req.path,
    mode,
  );

  if (sessionId) {
    c.set('effectiveSessionId', sessionId);
  }

  await next();
});
