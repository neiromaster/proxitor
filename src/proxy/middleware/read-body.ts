import { createMiddleware } from 'hono/factory';
import { logger, withReq } from '../../logger.js';
import type { ProxyEnv } from '../context.js';

export const readBody = createMiddleware<ProxyEnv>(async (c, next) => {
  const method = c.var.method;

  if (method === 'GET' || method === 'HEAD') {
    c.set('rawBody', undefined);
    await next();
    return;
  }

  try {
    const body = await c.req.raw.arrayBuffer();
    c.set('rawBody', body.byteLength > 0 ? body : undefined);
  } catch (err) {
    const internalMessage =
      err instanceof Error ? err.message : 'Failed to read request body';
    logger.error(withReq(c.var.reqId, internalMessage));
    return c.json(
      { error: { message: 'Failed to read request body', type: 'proxy_request_error' } },
      { status: 400 },
    );
  }

  await next();
});
