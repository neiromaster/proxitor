import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context, Next } from 'hono';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ProxyConfig } from '../../application/config-schema.js';
import type { ReloadResult } from '../../application/hot-reload.js';

/**
 * Control-plane routes (spec §D16).
 *
 * POST /reload — trigger config reload (returns ReloadResult shape).
 * GET /routing — read-only routing table snapshot (no credentials).
 *
 * Auth: Bearer token compared timing-safely via sha256 → timingSafeEqual.
 * Unauthorized → 401 with OpenAI-style error shape.
 * Wrong method → 405.
 */

/** Openai wire-error shape for auth failures. */
function unauthorizedResponse(): Response {
  return Response.json(
    { error: { message: 'unauthorized', type: 'invalid_request_error' } },
    { status: 401, headers: { 'content-type': 'application/json' } },
  );
}

/** Method not allowed response. */
function methodNotAllowedResponse(allow: string): Response {
  return Response.json(
    { error: { message: 'method not allowed', type: 'invalid_request_error' } },
    {
      status: 405,
      headers: { 'content-type': 'application/json', allow },
    },
  );
}

/**
 * Timing-safe Bearer token comparison.
 *
 * Prevents timing attacks by hashing both the provided token and the expected
 * token with SHA-256, then comparing the fixed-length digests with timingSafeEqual.
 */
function verifyToken(provided: string, expected: string): boolean {
  const tokenHash = createHash('sha256').update(provided, 'utf8').digest();
  const expectedHash = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(tokenHash, expectedHash);
}

/** Extract Bearer token from Authorization header. Returns undefined if missing/malformed. */
function extractBearerToken(authHeader: string | undefined): string | undefined {
  if (!authHeader) return undefined;
  const parts = authHeader.split(' ', 2);
  if (parts.length !== 2 || parts[0] !== 'Bearer') return undefined;
  return parts[1];
}

/** Authentication middleware — runs before route handlers. */
function authMiddleware(token: string) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.raw.headers.get('Authorization') ?? undefined;
    const providedToken = extractBearerToken(authHeader);

    if (providedToken === undefined || !verifyToken(providedToken, token)) {
      throw new HTTPException(401, { res: unauthorizedResponse() });
    }

    await next();
  };
}

/**
 * Explicit routing view — picks only safe fields.
 * Credentials/auth/headers cannot appear by construction.
 * Plugins arrays pass through verbatim (unknown).
 */
export function routingViewOf(config: ProxyConfig): {
  providers: Array<{
    id: string;
    baseUrl: string;
    wireFormat: string;
    plugins?: unknown;
  }>;
  models: Array<{
    match: string;
    provider: string;
    modelId: string;
    plugins?: unknown;
  }>;
  defaultProvider?: string;
  plugins?: unknown;
} {
  const providers: Array<{
    id: string;
    baseUrl: string;
    wireFormat: string;
    plugins?: unknown;
  }> = [];

  for (const provider of Object.values(config.providers)) {
    const entry: { id: string; baseUrl: string; wireFormat: string; plugins?: unknown } =
      {
        id: provider.id,
        baseUrl: provider.baseUrl,
        wireFormat: provider.wireFormat,
      };

    if (provider.plugins !== undefined) {
      entry.plugins = provider.plugins;
    }

    providers.push(entry);
  }

  const models: Array<{
    match: string;
    provider: string;
    modelId: string;
    plugins?: unknown;
  }> = [];

  for (const model of config.models) {
    const entry: { match: string; provider: string; modelId: string; plugins?: unknown } =
      {
        match: model.match,
        provider: model.provider,
        modelId: model.modelId,
      };

    if (model.plugins !== undefined) {
      entry.plugins = model.plugins;
    }

    models.push(entry);
  }

  const result: {
    providers: Array<{
      id: string;
      baseUrl: string;
      wireFormat: string;
      plugins?: unknown;
    }>;
    models: Array<{
      match: string;
      provider: string;
      modelId: string;
      plugins?: unknown;
    }>;
    defaultProvider?: string;
    plugins?: unknown;
  } = { providers, models };

  if (config.defaultProvider !== undefined) {
    result.defaultProvider = config.defaultProvider;
  }

  if (config.plugins !== undefined) {
    result.plugins = config.plugins;
  }

  return result;
}

/** Control-plane app factory. */
export function createControlPlaneApp(deps: {
  token: string;
  reload(): Promise<ReloadResult>;
  routingView(): Record<string, unknown>;
}): Hono {
  const app = new Hono();

  // Apply auth middleware to all routes
  app.use('*', authMiddleware(deps.token));

  // POST /reload — trigger config reload
  app.post('/reload', async c => {
    const result = await deps.reload();

    if (result.ok) {
      return c.json({ ok: true, changes: result.changes }, 200);
    } else {
      return c.json({ ok: false, error: result.error }, 400);
    }
  });

  // GET /routing — read-only routing snapshot
  app.get('/routing', c => {
    return c.json(deps.routingView(), 200);
  });

  // Method guards — return 405 for disallowed methods
  app.on(['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'], '/reload', _c => {
    throw new HTTPException(405, { res: methodNotAllowedResponse('POST') });
  });

  app.on(['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'], '/routing', _c => {
    throw new HTTPException(405, { res: methodNotAllowedResponse('GET') });
  });

  return app;
}
