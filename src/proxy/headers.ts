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

/**
 * Canonicalize a header record to lowercase keys.
 *
 * HTTP header names are case-insensitive (RFC 9110 §5.1), but a plain object
 * treats `Content-Type` and `content-type` as distinct keys. Lowercasing folds
 * case-variant keys into one so the merged record can never carry two headers
 * that differ only by case. Returns a new object; does not mutate the input.
 */
export function lowercaseKeys(record: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key.toLowerCase()] = value;
  }
  return result;
}

/** Filter response headers and add SSE-friendly defaults */
export function buildResponseHeaders(from: Headers): Record<string, string> {
  const headers = filterHeaders(from, STRIP_RESPONSE);

  headers['Cache-Control'] = 'no-cache';
  headers['X-Accel-Buffering'] = 'no';

  return headers;
}
