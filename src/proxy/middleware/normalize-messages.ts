import { createMiddleware } from 'hono/factory';
import type { ParsedRequestBody, ProxyEnv } from '../context.js';
import { liftSystemMessages, shouldNormalizeMessages } from '../utils/messages-system.js';

/** Lift stray role:"system" items from messages into top-level system (see liftSystemMessages); no-op for non-messages endpoints. */
export const normalizeMessagesMiddleware = createMiddleware<ProxyEnv>(async (c, next) => {
  const parsedBody: ParsedRequestBody | undefined = c.var.parsedBody;
  if (
    parsedBody &&
    shouldNormalizeMessages(c.var.resolvedConfig.normalizeMessages, c.req.path) &&
    liftSystemMessages(parsedBody)
  ) {
    c.set('bodyMutated', true);
  }

  await next();
});
