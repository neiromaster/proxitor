import { type ServerType, serve } from '@hono/node-server';
import { Hono } from 'hono';
import { buildProviderRouting, type ProxyConfig } from './config.js';
import { logger, withReq } from './logger.js';
import type { ProxyEnv } from './proxy/context.js';
import { buildUpstreamReq } from './proxy/middleware/build-upstream-req.js';
import { forwardRequest } from './proxy/middleware/forward-request.js';
import { injectCacheControl } from './proxy/middleware/inject-cache-control.js';
import { injectProvider } from './proxy/middleware/inject-provider.js';
import { injectSessionId } from './proxy/middleware/inject-session-id.js';
import { parseBody } from './proxy/middleware/parse-body.js';
import { readBody } from './proxy/middleware/read-body.js';
import { resolveConfig } from './proxy/middleware/resolve-config.js';
import { setupRequest } from './proxy/middleware/setup-request.js';
import { INJECT_PATHS } from './proxy/paths.js';

export {
  type CacheUsage,
  extractCacheUsage,
  extractCacheUsageFromSSE,
} from './proxy/cache-logging.js';

export { extractErrorDetail } from './proxy/middleware/forward-request.js';

// Reusable injection chain — applied to injectable POST endpoints
const injectChain = [
  parseBody,
  resolveConfig,
  injectProvider,
  injectCacheControl,
  injectSessionId,
] as const;

export function createProxyServer(config: ProxyConfig, onReady?: () => void): ServerType {
  const app = new Hono<ProxyEnv>();

  // Config middleware — inject ProxyConfig into every request
  app.use('*', async (c, next) => {
    c.set('config', config);
    await next();
  });

  // Health check
  app.get('/health', c => {
    const globalRouting = buildProviderRouting(config.provider);
    return c.json({
      ok: true,
      upstream: config.openrouterBaseUrl,
      provider: globalRouting ?? 'not configured',
      modelOverrides: config.modelOverrides ? Object.keys(config.modelOverrides) : [],
    });
  });

  // Injectable endpoints — full middleware chain with body injection
  for (const path of INJECT_PATHS) {
    app.post(
      path,
      setupRequest,
      readBody,
      ...injectChain,
      buildUpstreamReq,
      forwardRequest,
    );
  }

  // Pass-through for everything else — no injection middleware
  app.all('*', setupRequest, readBody, buildUpstreamReq, forwardRequest);

  // Global error handler
  app.onError((err, c) => {
    const reqId = (c.var as Record<string, unknown>).reqId ?? 'unknown';
    logger.error(withReq(String(reqId), `Unhandled error: ${err.message}`));
    return Response.json(
      { error: { message: 'Internal proxy error', type: 'proxy_internal_error' } },
      { status: 500 },
    );
  });

  return serve(
    {
      fetch: app.fetch,
      port: config.port,
      hostname: config.host,
    },
    onReady,
  );
}

const SHUTDOWN_TIMEOUT_MS = 10_000;

export function startProxyServer(config: ProxyConfig, onReady?: () => void): ServerType {
  const server = createProxyServer(config, onReady);

  let shuttingDown = false;

  function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`${signal} received — draining active connections…`);

    const timer = setTimeout(() => {
      logger.warn('Forcing shutdown — drain timeout exceeded');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    server.close(() => {
      clearTimeout(timer);
      logger.info('All connections drained — goodbye');
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}
