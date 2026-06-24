import { createMiddleware } from 'hono/factory';
import { resolveModelConfig } from '../../config.js';
import { logger } from '../../logger.js';
import type { ProxyEnv } from '../context.js';

export const resolveConfig = createMiddleware<ProxyEnv>(async (c, next) => {
  const resolved = resolveModelConfig(c.var.config, c.var.modelName);
  c.set('resolvedConfig', resolved);
  if (c.var.config.verbose && c.var.modelName) {
    logger.info(
      resolved.matchedOverride
        ? `override "${resolved.matchedOverride}" matched incoming "${c.var.modelName}"`
        : `no override matched for "${c.var.modelName}"`,
    );
  }
  await next();
});
