import { createMiddleware } from 'hono/factory';
import { logger, withReq } from '../../logger.js';
import type { ParsedRequestBody, ProxyEnv } from '../context.js';

const decoder = new TextDecoder();

export const parseBody = createMiddleware<ProxyEnv>(async (c, next) => {
  const rawBody = c.var.rawBody;

  if (!rawBody || rawBody.byteLength === 0) {
    c.set('parsedBody', undefined);
    c.set('modelName', undefined);
    await next();
    return;
  }

  try {
    const json = JSON.parse(decoder.decode(rawBody)) as ParsedRequestBody;
    c.set('parsedBody', json);
    c.set('modelName', typeof json.model === 'string' ? json.model : undefined);
  } catch {
    logger.debug(
      withReq(c.var.reqId, 'Failed to parse request body as JSON — skipping injection'),
    );
    c.set('parsedBody', undefined);
    c.set('modelName', undefined);
  }

  await next();
});
