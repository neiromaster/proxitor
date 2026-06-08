import { createMiddleware } from 'hono/factory';
import { logger, withReq } from '../../logger.js';
import type { ProxyEnv } from '../context.js';

function parseBodyLimit(limit: string): number {
  const match = limit.match(/^(\d+)\s*(kb|mb|gb)$/i);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const n = parseInt(match[1] as string, 10);
  const unit = (match[2] as string).toLowerCase();
  switch (unit) {
    case 'kb':
      return n * 1024;
    case 'mb':
      return n * 1024 * 1024;
    case 'gb':
      return n * 1024 * 1024 * 1024;
    default:
      return Number.MAX_SAFE_INTEGER;
  }
}

export const readBody = createMiddleware<ProxyEnv>(async (c, next) => {
  const method = c.var.method;

  if (method === 'GET' || method === 'HEAD') {
    c.set('rawBody', undefined);
    await next();
    return;
  }

  try {
    const body = await c.req.raw.arrayBuffer();

    const maxBytes = parseBodyLimit(c.var.config.bodyLimit);
    if (body.byteLength > maxBytes) {
      return c.json(
        { error: { message: 'Request body too large', type: 'proxy_request_error' } },
        { status: 413 },
      );
    }

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
