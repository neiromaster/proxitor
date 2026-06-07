import { createMiddleware } from 'hono/factory';
import type { ProxyEnv } from '../context.js';
import { buildCacheControl, shouldInjectCacheControl } from '../utils/cache-control.js';

export const injectCacheControl = createMiddleware<ProxyEnv>(async (c, next) => {
  const resolved = c.var.resolvedConfig;
  const parsedBody = c.var.parsedBody;

  if (!parsedBody) {
    await next();
    return;
  }

  if (shouldInjectCacheControl(resolved.cacheControl, c.var.modelName, c.var.path)) {
    parsedBody.cache_control = buildCacheControl(
      parsedBody.cache_control,
      resolved.cacheControlTtl,
      c.var.modelName,
      c.var.path,
    );
    c.set('parsedBody', parsedBody);
    c.set('bodyMutated', true);
  }

  await next();
});
