import type { ProxyConfig } from '../config.js';
import { formatAuthHeader } from '../utils.js';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Headers to strip from client request before forwarding */
const STRIP_REQUEST = new Set([
  'authorization',
  'x-api-key',
  'host',
  'content-length',
  'x-claude-code-session-id',
]);

/** Headers to strip from upstream response before forwarding */
const STRIP_RESPONSE = new Set(['content-length', 'content-encoding']);

/** Filter headers by removing hop-by-hop and an additional blocklist */
function filterHeaders(
  incoming: Headers,
  blocklist: ReadonlySet<string>,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of incoming.entries()) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (blocklist.has(lower)) continue;
    headers[key] = value;
  }
  return headers;
}

/** Build request headers for upstream fetch */
export function buildRequestHeaders(
  incoming: Headers,
  config: ProxyConfig,
  inject: boolean,
  extraHeaders?: Record<string, string>,
): Record<string, string> {
  const headers = filterHeaders(incoming, STRIP_REQUEST);

  headers.Authorization = formatAuthHeader(config.openrouterKey, config.authType);
  headers['HTTP-Referer'] = config.attributionReferer;
  headers['X-OpenRouter-Title'] = config.attributionTitle;
  headers['Accept-Encoding'] = 'identity';

  if (extraHeaders) {
    Object.assign(headers, extraHeaders);
  }

  if (inject) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

/** Filter response headers and add SSE-friendly defaults */
export function buildResponseHeaders(from: Headers): Record<string, string> {
  const headers = filterHeaders(from, STRIP_RESPONSE);

  headers['Cache-Control'] = 'no-cache';
  headers['X-Accel-Buffering'] = 'no';

  return headers;
}
