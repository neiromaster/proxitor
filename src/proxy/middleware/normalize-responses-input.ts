import { createMiddleware } from 'hono/factory';
import type { ParsedRequestBody, ProxyEnv } from '../context.js';
import {
  normalizeResponsesInput,
  shouldNormalizeResponses,
} from '../utils/responses-input.js';

/**
 * Normalize Responses-API `input` so it satisfies OpenRouter's strict schema —
 * see normalizeResponsesInput. No-op for chat-completions / messages.
 */
export const normalizeResponsesInputMiddleware = createMiddleware<ProxyEnv>(
  async (c, next) => {
    const parsedBody: ParsedRequestBody | undefined = c.var.parsedBody;
    if (
      parsedBody &&
      shouldNormalizeResponses(c.var.resolvedConfig.normalizeResponses, c.req.path) &&
      normalizeResponsesInput(parsedBody)
    ) {
      c.set('bodyMutated', true);
    }

    await next();
  },
);
