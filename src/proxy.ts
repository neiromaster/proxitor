import { type ServerType, serve } from '@hono/node-server';
import { Hono } from 'hono';
import { buildProviderRouting } from './config.js';
import type { ConfigSource } from './config-source.js';
import { logger, withReq } from './logger.js';
import type { ProxyEnv } from './proxy/context.js';
import { buildUpstreamReq } from './proxy/middleware/build-upstream-req.js';
import { forwardRequest } from './proxy/middleware/forward-request.js';
import { injectCacheControl } from './proxy/middleware/inject-cache-control.js';
import { injectProvider } from './proxy/middleware/inject-provider.js';
import { injectSessionId } from './proxy/middleware/inject-session-id.js';
import { normalizeVolatileSystemMiddleware } from './proxy/middleware/normalize-volatile-system.js';
import { parseBody } from './proxy/middleware/parse-body.js';
import { readBody } from './proxy/middleware/read-body.js';
import { resolveConfig } from './proxy/middleware/resolve-config.js';
import { setupRequest } from './proxy/middleware/setup-request.js';
import { createObservability } from './proxy/observability/observability.js';
import { INJECT_PATHS } from './proxy/paths.js';

const injectChain = [
  parseBody,
  resolveConfig,
  injectProvider,
  injectCacheControl,
  normalizeVolatileSystemMiddleware,
  injectSessionId,
] as const;

export function createProxyServer(
  source: ConfigSource,
  onReady?: () => void,
): ServerType {
  const app = new Hono<ProxyEnv>();

  const observability = createObservability(source.get());
  // Hot-reload: keep the classifier threshold and session-tracker sizing in
  // sync with config edits (otherwise they're pinned at startup while sibling
  // observability knobs like routerMetadata/sideMaxTokens live-reload).
  source.subscribe(config => observability.reconfigure(config));

  app.use('*', async (c, next) => {
    c.set('config', source.get());
    c.set('observability', observability);
    await next();
  });

  app.get('/health', c => {
    const config = source.get();
    const globalRouting = buildProviderRouting(config.provider);
    const modelOverrideKeys = Object.keys(config.modelOverrides ?? []);
    return c.json({
      ok: true,
      upstream: config.openrouterBaseUrl,
      provider: globalRouting ?? 'not configured',
      modelOverrides: modelOverrideKeys,
    });
  });

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

  app.all('*', setupRequest, readBody, resolveConfig, buildUpstreamReq, forwardRequest);

  app.onError((err, c) => {
    const reqId = c.var.reqId ?? 'unknown';
    logger.error(withReq(String(reqId), `Unhandled error: ${err.message}`));
    return Response.json(
      { error: { message: 'Internal proxy error', type: 'proxy_internal_error' } },
      { status: 500 },
    );
  });

  const initial = source.get();
  return serve(
    {
      fetch: app.fetch,
      port: initial.port,
      hostname: initial.host,
    },
    onReady,
  );
}

const SHUTDOWN_TIMEOUT_MS = 10_000;

export function startProxyServer(source: ConfigSource, onReady?: () => void): ServerType {
  const server = createProxyServer(source, onReady);

  let shuttingDown = false;

  function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`${signal} received — draining active connections…`);

    source.stop();
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
