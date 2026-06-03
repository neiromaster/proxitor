import { type HttpBindings, type ServerType, serve } from '@hono/node-server'
import { Hono } from 'hono'
import { buildProviderRouting, type ProxyConfig, resolveModelConfig } from './config.js'
import { logger } from './logger.js'
import { buildRequestHeaders, buildResponseHeaders } from './proxy/headers.js'
import { extractModel, injectProvider } from './proxy/inject.js'
import { buildUpstreamUrl, shouldInject } from './proxy/paths.js'

type ProxyContext = {
  Variables: {
    config: ProxyConfig
  }
  Bindings: HttpBindings
}

function readRequestBody(
  method: string,
  raw: ArrayBuffer,
  inject: boolean,
  providerRouting: Record<string, unknown>,
): ArrayBuffer | undefined {
  if (['GET', 'HEAD'].includes(method)) return undefined

  if (inject) {
    return injectProvider(raw, providerRouting)
  }

  return raw.byteLength > 0 ? raw : undefined
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
  })
}

function buildUpstreamResponse(upstream: Response, method: string): Response {
  const headers = buildResponseHeaders(upstream.headers)

  if (method === 'HEAD' || !upstream.body) {
    return new Response(null, { status: upstream.status, headers })
  }

  return new Response(upstream.body, { status: upstream.status, headers })
}

/** Read and process the request body, returning an error response on failure */
async function readRawBody(
  request: Request,
): Promise<{ ok: true; body: ArrayBuffer } | { ok: false; response: Response }> {
  try {
    const body = await request.arrayBuffer()
    return { ok: true, body }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read request body'
    logger.error(message)
    return {
      ok: false,
      response: Response.json(
        { error: { message, type: 'proxy_request_error' } },
        { status: 400 },
      ),
    }
  }
}

type ResolvedRequest = {
  inject: boolean
  body: ArrayBuffer | undefined
  modelName: string | undefined
  headers: Record<string, string> | undefined
  error?: Response
}

/** Resolve per-request config: extract model, resolve overrides, build routing and body */
function resolveRequest(
  rawBody: ArrayBuffer,
  config: ProxyConfig,
  method: string,
  path: string,
): ResolvedRequest {
  const modelName = extractModel(rawBody)
  const resolved = resolveModelConfig(config, modelName)
  const providerRouting = buildProviderRouting(resolved.provider)
  const inject = shouldInject(method, path) && providerRouting !== undefined

  let body: ArrayBuffer | undefined
  try {
    body = readRequestBody(
      method,
      rawBody,
      inject,
      providerRouting as Record<string, unknown>,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to process request body'
    logger.error(message)
    return {
      inject,
      body: undefined,
      modelName,
      headers: resolved.headers,
      error: new Response(
        JSON.stringify({ error: { message, type: 'proxy_request_error' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    }
  }

  return { inject, body, modelName, headers: resolved.headers }
}

/** Execute upstream fetch, returning appropriate error responses on failure */
async function executeUpstream(
  upstreamUrl: string,
  method: string,
  headers: Record<string, string>,
  body: ArrayBuffer | undefined,
  signal: AbortSignal,
  path: string,
  startedAt: number,
): Promise<Response> {
  let upstream: Response
  try {
    upstream = await fetchUpstream(upstreamUrl, method, headers, body, signal)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      logger.warn(`Aborted: ${method} ${path}`)
      return new Response(null, { status: 499 })
    }

    logger.error('Upstream fetch error:', err)
    return Response.json(
      {
        error: {
          message: 'Proxy failed to reach upstream',
          type: 'proxy_upstream_error',
        },
      },
      { status: 502 },
    )
  }

  logger.info(`${method} ${path} ← ${upstream.status} (${Date.now() - startedAt}ms)`)
  return buildUpstreamResponse(upstream, method)
}

export function createProxyServer(config: ProxyConfig, onReady?: () => void): ServerType {
  const app = new Hono<ProxyContext>()

  app.get('/health', c => {
    const globalRouting = buildProviderRouting(config.provider)
    return c.json({
      ok: true,
      upstream: config.openrouterBaseUrl,
      provider: globalRouting ?? 'not configured',
      modelOverrides: config.modelOverrides ? Object.keys(config.modelOverrides) : [],
    })
  })

  app.all('*', async c => {
    const method = c.req.method
    const path = new URL(c.req.url).pathname
    const upstreamUrl = buildUpstreamUrl(c.req.url, config)
    const startedAt = Date.now()

    const raw = await readRawBody(c.req.raw)
    if (!raw.ok) return raw.response

    const resolved = resolveRequest(raw.body, config, method, path)
    if (resolved.error) return resolved.error

    const headers = buildRequestHeaders(
      c.req.raw.headers,
      config,
      resolved.inject,
      resolved.headers,
    )

    const controller = new AbortController()
    c.req.raw.signal.addEventListener('abort', () => controller.abort())

    const modelLog = resolved.modelName ? ` model=${resolved.modelName}` : ''
    logger.info(
      `${method} ${path} → ${upstreamUrl}${resolved.inject ? ' [inject]' : ''}${modelLog}`,
    )

    return executeUpstream(
      upstreamUrl,
      method,
      headers,
      resolved.body,
      controller.signal,
      path,
      startedAt,
    )
  })

  return serve(
    {
      fetch: app.fetch,
      port: config.port,
      hostname: config.host,
    },
    onReady,
  )
}

/** Shutdown deadline: force-close after this many ms */
const SHUTDOWN_TIMEOUT_MS = 10_000

/** Start the proxy with graceful shutdown on SIGTERM/SIGINT */
export function startProxyServer(config: ProxyConfig, onReady?: () => void): ServerType {
  const server = createProxyServer(config, onReady)

  let shuttingDown = false

  function shutdown(signal: string) {
    if (shuttingDown) return
    shuttingDown = true

    logger.info(`${signal} received — draining active connections…`)

    const timer = setTimeout(() => {
      logger.warn('Forcing shutdown — drain timeout exceeded')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS)

    server.close(() => {
      clearTimeout(timer)
      logger.info('All connections drained — goodbye')
      process.exit(0)
    })
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  return server
}
