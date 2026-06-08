import { createMiddleware } from 'hono/factory';
import { buildProviderRouting } from '../../config.js';
import type { ProxyEnv } from '../context.js';

export const injectProvider = createMiddleware<ProxyEnv>(async (c, next) => {
  const resolved = c.var.resolvedConfig;
  const parsedBody = c.var.parsedBody;

  if (!parsedBody || !resolved.provider) {
    await next();
    return;
  }

  const providerRouting = buildProviderRouting(resolved.provider);
  if (providerRouting !== undefined) {
    parsedBody.provider = providerRouting;
    c.set('parsedBody', parsedBody);
    c.set('bodyMutated', true);
  }

  await next();
});
