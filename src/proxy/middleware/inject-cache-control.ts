import { createMiddleware } from 'hono/factory';
import type { ProxyEnv } from '../context.js';
import {
  buildCacheControlValue,
  isAnthropicEndpoint,
  shouldInjectCacheControl,
  TTL_SECONDS,
} from '../utils/cache-control.js';

export const injectCacheControl = createMiddleware<ProxyEnv>(async (c, next) => {
  const resolved = c.var.resolvedConfig;
  const parsedBody = c.var.parsedBody;

  if (!parsedBody) {
    await next();
    return;
  }

  const mode = resolved.cacheControl;
  const shouldInject = shouldInjectCacheControl(mode, c.var.modelName, c.var.path);

  if (shouldInject && !('cache_control' in parsedBody)) {
    parsedBody.cache_control = buildCacheControlValue(
      resolved.cacheControlTtl,
      c.var.modelName,
      c.var.path,
    );
    c.set('parsedBody', parsedBody);
    c.set('bodyMutated', true);
  } else if (shouldInject && resolved.cacheControlTtl) {
    const cc = parsedBody.cache_control as Record<string, unknown> | undefined;
    if (cc && !('ttl' in cc) && isAnthropicEndpoint(c.var.modelName, c.var.path)) {
      cc.ttl = TTL_SECONDS[resolved.cacheControlTtl];
      c.set('parsedBody', parsedBody);
      c.set('bodyMutated', true);
    }
  }

  await next();
});
