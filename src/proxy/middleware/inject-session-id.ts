import { createMiddleware } from 'hono/factory';
import type { ProxyEnv } from '../context.js';
import { deriveSessionId } from './session-id.js';

export const injectSessionId = createMiddleware<ProxyEnv>(async (c, next) => {
  const resolved = c.var.resolvedConfig;
  const parsedBody = c.var.parsedBody;

  if (!parsedBody) {
    await next();
    return;
  }

  const mode = resolved.sessionId ?? 'auto';
  const sessionId = deriveSessionId(c.req.raw.headers, mode);

  if (!sessionId) {
    await next();
    return;
  }

  if ('session_id' in parsedBody) {
    // Body already has session_id — use the existing value for header consistency
    c.set('effectiveSessionId', String(parsedBody.session_id));
  } else {
    parsedBody.session_id = sessionId;
    c.set('effectiveSessionId', sessionId);
  }

  c.set('parsedBody', parsedBody);
  c.set('bodyMutated', true);

  await next();
});
