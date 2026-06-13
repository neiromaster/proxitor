import { createMiddleware } from 'hono/factory';
import { requestId } from '../../logger.js';
import type { ProxyEnv } from '../context.js';
import { buildUpstreamUrl } from '../paths.js';

export const setupRequest = createMiddleware<ProxyEnv>(async (c, next) => {
  const method = c.req.method;
  const { pathname, search } = new URL(c.req.url);
  // Preserve the query string when forwarding (e.g. ?stream=true).
  const path = `${pathname}${search}`;

  c.set('reqId', requestId());
  c.set('method', method);
  c.set('path', path);
  c.set('upstreamUrl', buildUpstreamUrl(path, c.var.config));
  c.set('startedAt', Date.now());
  // Must be false (not undefined): downstream mutation checks depend on a boolean.
  c.set('bodyMutated', false);

  await next();
});
