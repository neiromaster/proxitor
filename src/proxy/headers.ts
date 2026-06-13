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

export const STRIP_REQUEST = new Set([
  'authorization',
  'x-api-key',
  'host',
  'content-length',
]);

const STRIP_RESPONSE = new Set(['content-length', 'content-encoding']);

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

/** Lowercase keys so case-variants don't coexist in a plain object (RFC 9110 §5.1). */
export function lowercaseKeys(record: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key.toLowerCase()] = value;
  }
  return result;
}

export function buildResponseHeaders(from: Headers): Record<string, string> {
  const headers = filterHeaders(from, STRIP_RESPONSE);

  headers['Cache-Control'] = 'no-cache';
  headers['X-Accel-Buffering'] = 'no';

  return headers;
}
