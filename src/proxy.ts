import { type HttpBindings, type ServerType, serve } from '@hono/node-server';
import { Hono } from 'hono';
import { buildProviderRouting, type ProxyConfig, resolveModelConfig } from './config.js';
import { logger, requestId, withReq } from './logger.js';
import { buildUpstreamResponseWithLogging } from './proxy/cache-logging.js';
import { buildRequestHeaders, buildResponseHeaders } from './proxy/headers.js';
import {
  extractModel,
  type InjectionParams,
  type InjectionResult,
  injectBodyFields,
  isAnthropicModel,
} from './proxy/inject.js';
import { buildUpstreamUrl, shouldInject } from './proxy/paths.js';

export {
  type CacheUsage,
  extractCacheUsage,
  extractCacheUsageFromSSE,
} from './proxy/cache-logging.js';

type ProxyContext = {
  Variables: {
    config: ProxyConfig;
  };
  Bindings: HttpBindings;
};

const PROXY_SESSION_ID = crypto.randomUUID();

function deriveSessionId(
  incomingHeaders: Headers,
  mode: 'auto' | 'always' | 'never',
): string | undefined {
  if (mode === 'never') return undefined;
  const fromClient = incomingHeaders.get('x-claude-code-session-id');
  if (fromClient) return fromClient.slice(0, 256);
  // Both 'auto' and 'always' fall back to proxy UUID for maximum sticky routing
  return PROXY_SESSION_ID;
}

function shouldInjectCacheControl(
  mode: 'auto' | 'always' | 'never',
  modelName: string | undefined,
  path: string,
): boolean {
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  // auto mode: only skip for non-Anthropic models on /v1/chat/completions
  // (other injectable paths are always safe per OpenRouter API)
  if (path === '/v1/chat/completions' && !isAnthropicModel(modelName ?? '')) return false;
  return true;
}

async function fetchUpstream(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: ArrayBuffer | undefined,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(url, {
    method,
    headers,
    body,
    signal,
    duplex: body ? 'half' : undefined,
  });
}

async function readRawBody(
  request: Request,
  reqId: string,
): Promise<{ ok: true; body: ArrayBuffer } | { ok: false; response: Response }> {
  try {
    const body = await request.arrayBuffer();
    return { ok: true, body };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read request body';
    logger.error(withReq(reqId, message));
    return {
      ok: false,
      response: Response.json(
        { error: { message, type: 'proxy_request_error' } },
        { status: 400 },
      ),
    };
  }
}

type ResolvedRequest = {
  inject: boolean;
  body: ArrayBuffer | undefined;
  modelName: string | undefined;
  headers: Record<string, string> | undefined;
  error?: Response;
};

function isReadonlyMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}

type ResolvedModelConfig = Awaited<ReturnType<typeof resolveModelConfig>>;

type InjectionDecision = {
  params: InjectionParams;
  sessionId: string | undefined;
};

function computeInjection(
  rawBody: ArrayBuffer,
  config: ProxyConfig,
  path: string,
  incomingHeaders: Headers,
): { modelName: string | undefined; resolved: ResolvedModelConfig } & (
  | { inject: false }
  | (InjectionDecision & { inject: true })
) {
  const modelName = extractModel(rawBody);
  const resolved = resolveModelConfig(config, modelName);
  const providerRouting = buildProviderRouting(resolved.provider);
  const eligibleForInjection = shouldInject('POST', path);
  if (!eligibleForInjection) return { modelName, resolved, inject: false };

  const cacheControlMode = resolved.cacheControl ?? 'auto';
  const sessionIdMode = resolved.sessionId ?? 'auto';
  const injectCacheControl = shouldInjectCacheControl(cacheControlMode, modelName, path);
  const sessionId = deriveSessionId(incomingHeaders, sessionIdMode);

  if (providerRouting === undefined && !injectCacheControl && sessionId === undefined) {
    return { modelName, resolved, inject: false };
  }

  return {
    modelName,
    resolved,
    inject: true,
    params: {
      providerRouting: providerRouting as Record<string, unknown> | undefined,
      cacheControl: injectCacheControl,
      sessionId,
    },
    sessionId,
  };
}

function resolveRequest(
  rawBody: ArrayBuffer,
  config: ProxyConfig,
  method: string,
  path: string,
  reqId: string,
  incomingHeaders: Headers,
): ResolvedRequest {
  const decision = computeInjection(rawBody, config, path, incomingHeaders);

  let body: ArrayBuffer | undefined;
  let bodyModified = false;
  let effectiveSessionId: string | undefined;

  try {
    if (decision.inject) {
      const result: InjectionResult = injectBodyFields(rawBody, decision.params);
      body = result.body;
      bodyModified = true;
      effectiveSessionId = result.effectiveSessionId;
    } else if (!isReadonlyMethod(method)) {
      body = rawBody.byteLength > 0 ? rawBody : undefined;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to process request body';
    // Fall back to forwarding as-is instead of returning 400
    if (!isReadonlyMethod(method) && rawBody.byteLength > 0) {
      body = rawBody;
      logger.warn(withReq(reqId, `${message}; forwarding body as-is`));
    } else {
      body = undefined;
      logger.warn(withReq(reqId, message));
    }
  }

  const finalHeaders = { ...(decision.resolved.headers ?? {}) };
  if (effectiveSessionId !== undefined) {
    finalHeaders['x-session-id'] = effectiveSessionId;
  }

  return {
    inject: bodyModified,
    body,
    modelName: decision.modelName,
    headers: finalHeaders,
  };
}

/**
 * Extract a readable error detail from an upstream response body.
 *
 * OpenRouter error format:
 *   { error: { code: 400, message: "...", metadata: { raw: "...", provider_name: "..." } } }
 *
 * - `error.message` — human-readable summary
 * - `error.metadata.provider_name` — which provider caused it (null = OpenRouter itself)
 * - `error.metadata.raw` — the original provider error (most specific cause)
 */
function formatMetadata(meta: Record<string, unknown>): string[] {
  const parts: string[] = [];
  if (meta.provider_name) parts.push(`provider=${meta.provider_name}`);
  if (meta.raw) {
    const raw = typeof meta.raw === 'string' ? meta.raw : JSON.stringify(meta.raw);
    parts.push(raw);
  }
  return parts;
}

export function extractErrorDetail(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText);
    if (typeof parsed !== 'object' || parsed === null) return bodyText;

    const err = parsed.error;
    if (typeof err === 'object' && err !== null && err.message) {
      const parts: string[] = [];
      if (err.code != null) parts.push(String(err.code));
      parts.push(String(err.message));
      if (err.metadata && typeof err.metadata === 'object') {
        parts.push(...formatMetadata(err.metadata as Record<string, unknown>));
      }
      return parts.join(' | ');
    }
    if (parsed.message) return String(parsed.message);
  } catch {
    // non-JSON
  }
  return bodyText;
}

async function executeUpstream(
  upstreamUrl: string,
  method: string,
  headers: Record<string, string>,
  body: ArrayBuffer | undefined,
  signal: AbortSignal,
  path: string,
  startedAt: number,
  reqId: string,
): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetchUpstream(upstreamUrl, method, headers, body, signal);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      logger.warn(withReq(reqId, `Aborted: ${method} ${path}`));
      return new Response(null, { status: 499 });
    }

    logger.error(withReq(reqId, 'Upstream fetch error:'), err);
    return Response.json(
      {
        error: {
          message: 'Proxy failed to reach upstream',
          type: 'proxy_upstream_error',
        },
      },
      { status: 502 },
    );
  }

  if (upstream.status >= 400) {
    const bodyText = await upstream.text();
    const detail = extractErrorDetail(bodyText);
    const truncated = detail.length > 300 ? `${detail.slice(0, 300)}…` : detail;
    const logFn = upstream.status >= 500 ? logger.error : logger.warn;

    logFn(
      withReq(
        reqId,
        `${method} ${path} ← ${upstream.status} (${Date.now() - startedAt}ms): ${truncated}`,
      ),
    );

    const responseHeaders = buildResponseHeaders(upstream.headers);
    if (method === 'HEAD') {
      return new Response(null, { status: upstream.status, headers: responseHeaders });
    }
    return new Response(bodyText, { status: upstream.status, headers: responseHeaders });
  }

  logger.info(
    withReq(
      reqId,
      `${method} ${path} ← ${upstream.status} (${Date.now() - startedAt}ms)`,
    ),
  );

  return buildUpstreamResponseWithLogging(upstream, method, reqId);
}

export function createProxyServer(config: ProxyConfig, onReady?: () => void): ServerType {
  const app = new Hono<ProxyContext>();

  app.get('/health', c => {
    const globalRouting = buildProviderRouting(config.provider);
    return c.json({
      ok: true,
      upstream: config.openrouterBaseUrl,
      provider: globalRouting ?? 'not configured',
      modelOverrides: config.modelOverrides ? Object.keys(config.modelOverrides) : [],
    });
  });

  app.all('*', async c => {
    const method = c.req.method;
    const path = new URL(c.req.url).pathname;
    const upstreamUrl = buildUpstreamUrl(c.req.url, config);
    const startedAt = Date.now();
    const reqId = requestId();

    const raw = await readRawBody(c.req.raw, reqId);
    if (!raw.ok) return raw.response;

    const resolved = resolveRequest(
      raw.body,
      config,
      method,
      path,
      reqId,
      c.req.raw.headers,
    );
    if (resolved.error) return resolved.error;

    const headers = buildRequestHeaders(
      c.req.raw.headers,
      config,
      resolved.inject,
      resolved.headers,
    );

    const controller = new AbortController();
    c.req.raw.signal.addEventListener('abort', () => controller.abort());

    const upstreamShort = upstreamUrl.replace(/^https?:\/\//, '');
    const modelLog = resolved.modelName ? ` model=${resolved.modelName}` : '';
    logger.info(
      withReq(
        reqId,
        `${method} ${path} → ${upstreamShort}${resolved.inject ? ' [inject]' : ''}${modelLog}`,
      ),
    );

    return executeUpstream(
      upstreamUrl,
      method,
      headers,
      resolved.body,
      controller.signal,
      path,
      startedAt,
      reqId,
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
