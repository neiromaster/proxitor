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
export const STRIP_REQUEST = new Set([
  'authorization',
  'x-api-key',
  'host',
  'content-length',
]);

/** Headers to strip from upstream response before forwarding */
const STRIP_RESPONSE = new Set(['content-length', 'content-encoding']);

/** Filter headers by removing hop-by-hop and an additional blocklist */
export function filterHeaders(
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

/** Filter response headers and add SSE-friendly defaults */
export function buildResponseHeaders(from: Headers): Record<string, string> {
  const headers = filterHeaders(from, STRIP_RESPONSE);

  headers['Cache-Control'] = 'no-cache';
  headers['X-Accel-Buffering'] = 'no';

  return headers;
}
