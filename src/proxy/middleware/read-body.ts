import { createMiddleware } from 'hono/factory';
import { logger, withReq } from '../../logger.js';
import type { ProxyEnv } from '../context.js';

export const readBody = createMiddleware<ProxyEnv>(async (c, next) => {
  const method = c.var.method;

  // Skip body read for readonly methods
  if (method === 'GET' || method === 'HEAD') {
    c.set('rawBody', undefined);
    await next();
    return;
  }

  try {
    const body = await c.req.raw.arrayBuffer();
    c.set('rawBody', body.byteLength > 0 ? body : undefined);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read request body';
    logger.error(withReq(c.var.reqId, message));
    c.set('rawBody', undefined);
  }

  await next();
});
