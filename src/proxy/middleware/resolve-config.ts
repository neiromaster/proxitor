import { createMiddleware } from 'hono/factory';
import { resolveModelConfig } from '../../config.js';
import type { ProxyEnv } from '../context.js';

export const resolveConfig = createMiddleware<ProxyEnv>(async (c, next) => {
  const resolved = resolveModelConfig(c.var.config, c.var.modelName);
  c.set('resolvedConfig', resolved);
  await next();
});
