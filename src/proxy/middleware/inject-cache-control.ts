import { createMiddleware } from 'hono/factory';
import type { ProxyEnv } from '../context.js';
import { shouldInjectCacheControl } from '../utils/cache-control.js';

export const injectCacheControl = createMiddleware<ProxyEnv>(async (c, next) => {
  const resolved = c.var.resolvedConfig;
  const parsedBody = c.var.parsedBody;

  if (!parsedBody) {
    await next();
    return;
  }

  const mode = resolved.cacheControl ?? 'auto';
  const shouldInject = shouldInjectCacheControl(mode, c.var.modelName, c.var.path);

  if (shouldInject && !('cache_control' in parsedBody)) {
    parsedBody.cache_control = { type: 'ephemeral' };
    c.set('parsedBody', parsedBody);
    c.set('bodyMutated', true);
  }

  await next();
});
