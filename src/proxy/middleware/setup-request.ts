import { createMiddleware } from 'hono/factory';
import { requestId } from '../../logger.js';
import type { ProxyEnv } from '../context.js';
import { buildUpstreamUrl } from '../paths.js';

export const setupRequest = createMiddleware<ProxyEnv>(async (c, next) => {
  const method = c.req.method;
  const { pathname, search } = new URL(c.req.url);
  // `path` carries both pathname and query string so the upstream URL
  // preserves any `?stream=true` or other client-side parameters.
  const path = `${pathname}${search}`;

  c.set('reqId', requestId());
  c.set('method', method);
  c.set('path', path);
  c.set('upstreamUrl', buildUpstreamUrl(path, c.var.config));
  c.set('startedAt', Date.now());
  // `bodyMutated` is the only field whose type isn't `T | undefined`, so it
  // needs an explicit false default — every other ProxyVariables field is
  // already undefined until the middleware that owns it sets a value, and
  // Hono's per-request context would return undefined for unset keys anyway.
  c.set('bodyMutated', false);

  await next();
});
