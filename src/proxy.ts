import { type HttpBindings, type ServerType, serve } from '@hono/node-server'
import { Hono } from 'hono'
import { buildProviderRouting, type ProxyConfig } from './config.js'
import { logger } from './logger.js'
import { buildRequestHeaders, buildResponseHeaders } from './proxy/headers.js'
import { injectProvider } from './proxy/inject.js'
import { buildUpstreamUrl, shouldInject } from './proxy/paths.js'

type ProxyContext = {
  Variables: {
    config: ProxyConfig
    providerRouting: Record<string, unknown> | undefined
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

async function getBody(
  request: Request,
  method: string,
  inject: boolean,
  providerRouting: Record<string, unknown> | undefined,
): Promise<ArrayBuffer | undefined> {
  const raw = await request.arrayBuffer()
  return readRequestBody(method, raw, inject, providerRouting as Record<string, unknown>)
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

export function createProxyServer(config: ProxyConfig, onReady?: () => void): ServerType {
  const app = new Hono<ProxyContext>()
  const providerRouting = buildProviderRouting(config)

  app.get('/health', c => {
    return c.json({
      ok: true,
      upstream: config.openrouterBaseUrl,
      provider: providerRouting ?? 'not configured',
    })
  })

  app.all('*', async c => {
    const method = c.req.method
    const path = new URL(c.req.url).pathname
    const upstreamUrl = buildUpstreamUrl(c.req.url, config)
    const inject = shouldInject(method, path) && providerRouting !== undefined
    const startedAt = Date.now()

    let body: ArrayBuffer | undefined
    try {
      body = await getBody(c.req.raw, method, inject, providerRouting)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to read request body'
      logger.error(message)
      return c.json({ error: { message, type: 'proxy_request_error' } }, 400)
    }

    const headers = buildRequestHeaders(c.req.raw.headers, config, inject)

    const controller = new AbortController()
    c.req.raw.signal.addEventListener('abort', () => {
      controller.abort()
    })

    logger.info(`${method} ${path} → ${upstreamUrl}${inject ? ' [inject]' : ''}`)

    let upstream: Response
    try {
      upstream = await fetchUpstream(
        upstreamUrl,
        method,
        headers,
        body,
        controller.signal,
      )
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        logger.warn(`Aborted: ${method} ${path}`)
        return new Response(null, { status: 499 })
      }

      logger.error('Upstream fetch error:', err)
      return c.json(
        {
          error: {
            message: 'Proxy failed to reach upstream',
            type: 'proxy_upstream_error',
          },
        },
        502,
      )
    }

    logger.info(`${method} ${path} ← ${upstream.status} (${Date.now() - startedAt}ms)`)

    return buildUpstreamResponse(upstream, method)
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
