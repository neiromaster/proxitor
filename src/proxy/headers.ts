import type { ProxyConfig } from '../config.js'

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

/** Headers to strip from client request before forwarding */
const STRIP_REQUEST = new Set(['authorization', 'x-api-key', 'host', 'content-length'])

/** Headers to strip from upstream response before forwarding */
const STRIP_RESPONSE = new Set(['content-length', 'content-encoding'])

/** Build request headers for upstream fetch */
export function buildRequestHeaders(
  incoming: Headers,
  config: ProxyConfig,
  inject: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {}

  for (const [key, value] of incoming.entries()) {
    const lower = key.toLowerCase()
    if (HOP_BY_HOP.has(lower)) continue
    if (STRIP_REQUEST.has(lower)) continue
    headers[key] = value
  }

  headers.Authorization = `Bearer ${config.openrouterKey}`
  headers['HTTP-Referer'] = config.attributionReferer
  headers['X-Title'] = config.attributionTitle
  headers['Accept-Encoding'] = 'identity'

  if (inject) {
    headers['Content-Type'] = 'application/json'
  }

  return headers
}

/** Filter response headers and add SSE-friendly defaults */
export function buildResponseHeaders(from: Headers): Record<string, string> {
  const headers: Record<string, string> = {}

  for (const [key, value] of from.entries()) {
    const lower = key.toLowerCase()
    if (HOP_BY_HOP.has(lower)) continue
    if (STRIP_RESPONSE.has(lower)) continue
    headers[key] = value
  }

  headers['Cache-Control'] = 'no-cache'
  headers['X-Accel-Buffering'] = 'no'

  return headers
}
