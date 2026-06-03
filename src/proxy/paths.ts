import type { ProxyConfig } from '../config.js'

/**
 * Paths where provider routing is injected into the request body.
 * All three are OpenRouter-supported endpoints:
 *   /v1/chat/completions — OpenAI Chat Completions
 *   /v1/responses        — OpenAI Responses API
 *   /v1/messages         — Anthropic Messages API
 */
export const INJECT_PATHS = new Set([
  '/v1/chat/completions',
  '/v1/responses',
  '/v1/messages',
])

/** Check if this request should have provider routing injected */
export function shouldInject(method: string, path: string): boolean {
  return method === 'POST' && INJECT_PATHS.has(path)
}

/** Strip /v1 prefix: /v1/chat/completions → /chat/completions */
export function toUpstreamPath(originalUrl: string): string {
  if (originalUrl.startsWith('/v1')) {
    return originalUrl.slice('/v1'.length)
  }
  return originalUrl
}

/** Build full upstream URL from request and config */
export function buildUpstreamUrl(originalUrl: string, config: ProxyConfig): string {
  return `${config.openrouterBaseUrl}${toUpstreamPath(originalUrl)}`
}
