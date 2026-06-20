import { createMiddleware } from 'hono/factory';
import type { ProxyEnv } from '../context.js';
import {
  buildCacheControl,
  isAnthropicEndpoint,
  rewriteBlockTtls,
  shouldInjectCacheControl,
  shouldRewriteBlockTtl,
} from '../utils/cache-control.js';

export const injectCacheControl = createMiddleware<ProxyEnv>(async (c, next) => {
  const resolved = c.var.resolvedConfig;
  const parsedBody = c.var.parsedBody;

  if (!parsedBody) {
    await next();
    return;
  }

  const isAnthropic = isAnthropicEndpoint(c.var.modelName, c.req.path);
  let mutated = false;

  if (shouldInjectCacheControl(resolved.cacheControl, c.var.modelName, c.req.path)) {
    parsedBody.cache_control = buildCacheControl(
      parsedBody.cache_control,
      resolved.cacheControlTtl,
      isAnthropic,
    );
    mutated = true;
  }

  if (
    shouldRewriteBlockTtl(
      resolved.rewriteBlockTtl,
      resolved.cacheControl,
      c.var.modelName,
      c.req.path,
    )
  ) {
    if (rewriteBlockTtls(parsedBody, resolved.cacheControlTtl, isAnthropic)) {
      mutated = true;
    }
  }

  if (mutated) c.set('bodyMutated', true);

  await next();
});
