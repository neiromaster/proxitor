import { createMiddleware } from 'hono/factory';
import { requestId } from '../../logger.js';
import type { ProxyEnv } from '../context.js';
import { buildUpstreamUrl } from '../paths.js';

export const setupRequest = createMiddleware<ProxyEnv>(async (c, next) => {
  const method = c.req.method;
  const { pathname: path } = new URL(c.req.url);

  c.set('reqId', requestId());
  c.set('method', method);
  c.set('path', path);
  c.set('upstreamUrl', buildUpstreamUrl(path, c.var.config));
  c.set('startedAt', Date.now());

  c.set('rawBody', undefined);
  c.set('parsedBody', undefined);
  c.set('modelName', undefined);
  c.set('bodyMutated', false);
  c.set('effectiveSessionId', undefined);
  c.set('forwardBody', undefined);
  c.set('upstreamHeaders', {});

  await next();
});
