import { logger, withReq } from '../logger.js';
import { buildResponseHeaders } from './headers.js';

export type CacheUsage = {
  cacheRead: number;
  cacheCreate: number;
};

export function extractCacheUsage(bodyText: string): CacheUsage | undefined {
  try {
    const parsed = JSON.parse(bodyText);
    if (typeof parsed !== 'object' || parsed === null) return undefined;

    const usage = parsed.usage;
    if (typeof usage !== 'object' || usage === null) return undefined;

    const result: CacheUsage = { cacheRead: 0, cacheCreate: 0 };

    if (typeof usage.cache_read_input_tokens === 'number') {
      result.cacheRead = usage.cache_read_input_tokens;
    }
    if (typeof usage.cache_creation_input_tokens === 'number') {
      result.cacheCreate = usage.cache_creation_input_tokens;
    }

    const details = usage.prompt_tokens_details;
    if (typeof details === 'object' && details !== null) {
      if (
        typeof details.cached_tokens === 'number' &&
        details.cached_tokens > 0 &&
        result.cacheRead === 0
      ) {
        result.cacheRead = details.cached_tokens;
      }
      if (
        typeof details.cache_write_tokens === 'number' &&
        details.cache_write_tokens > 0 &&
        result.cacheCreate === 0
      ) {
        result.cacheCreate = details.cache_write_tokens;
      }
    }

    return result;
  } catch {
    return undefined;
  }
}

function applyAnthropicFields(u: Record<string, unknown>, result: CacheUsage): boolean {
  let found = false;
  if (
    typeof u.cache_read_input_tokens === 'number' &&
    (u.cache_read_input_tokens as number) > 0
  ) {
    result.cacheRead = u.cache_read_input_tokens as number;
    found = true;
  }
  if (
    typeof u.cache_creation_input_tokens === 'number' &&
    (u.cache_creation_input_tokens as number) > 0
  ) {
    result.cacheCreate = u.cache_creation_input_tokens as number;
    found = true;
  }
  return found;
}

function applyOpenAIFields(
  details: Record<string, unknown>,
  result: CacheUsage,
): boolean {
  let found = false;
  if (
    typeof details.cached_tokens === 'number' &&
    (details.cached_tokens as number) > 0
  ) {
    result.cacheRead = details.cached_tokens as number;
    found = true;
  }
  if (
    typeof details.cache_write_tokens === 'number' &&
    (details.cache_write_tokens as number) > 0
  ) {
    result.cacheCreate = details.cache_write_tokens as number;
    found = true;
  }
  return found;
}

function extractFromEvent(parsed: unknown, result: CacheUsage): boolean {
  if (typeof parsed !== 'object' || parsed === null) return false;

  const container = (parsed as Record<string, unknown>).message ?? parsed;
  const usage = (container as Record<string, unknown>).usage;
  if (typeof usage !== 'object' || usage === null) return false;

  const u = usage as Record<string, unknown>;
  let found = false;

  found = applyAnthropicFields(u, result) || found;

  const details = u.prompt_tokens_details;
  if (typeof details === 'object' && details !== null) {
    found = applyOpenAIFields(details as Record<string, unknown>, result) || found;
  }

  return found;
}

export function extractCacheUsageFromSSE(fullText: string): CacheUsage | undefined {
  const result: CacheUsage = { cacheRead: 0, cacheCreate: 0 };
  let found = false;

  for (const line of fullText.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') continue;

    try {
      if (extractFromEvent(JSON.parse(payload), result)) found = true;
    } catch {
      // non-JSON data line
    }
  }

  return found ? result : undefined;
}

function formatCacheUsage(usage: CacheUsage, reqId: string): void {
  const parts: string[] = [];
  if (usage.cacheRead > 0) parts.push(`read: ${usage.cacheRead}`);
  if (usage.cacheCreate > 0) parts.push(`write: ${usage.cacheCreate}`);
  logger.info(
    withReq(
      reqId,
      parts.length > 0 ? `Cache ${parts.join(', ')} tokens` : 'Cache: no cached tokens',
    ),
  );
}

function createLoggingStream(
  contentType: string,
  reqId: string,
): TransformStream<Uint8Array, Uint8Array> {
  const chunks: Uint8Array[] = [];

  return new TransformStream({
    transform(
      chunk: Uint8Array,
      controller: TransformStreamDefaultController<Uint8Array>,
    ) {
      controller.enqueue(chunk);
      chunks.push(chunk);
    },
    flush() {
      try {
        const decoder = new TextDecoder();
        const fullText = chunks.reduce(
          (acc, chunk) => acc + decoder.decode(chunk, { stream: true }),
          '',
        );
        const remaining = decoder.decode();
        const text = fullText + remaining;

        const isSSE = contentType.toLowerCase().includes('text/event-stream');
        const usage = isSSE ? extractCacheUsageFromSSE(text) : extractCacheUsage(text);

        if (usage) {
          formatCacheUsage(usage, reqId);
        }
      } catch (err) {
        logger.debug(
          withReq(
            reqId,
            `Cache usage extraction failed: ${err instanceof Error ? err.message : err}`,
          ),
        );
      }
    },
  });
}

export function buildUpstreamResponseWithLogging(
  upstream: Response,
  method: string,
  reqId: string,
): Response {
  const headers = buildResponseHeaders(upstream.headers);

  if (method === 'HEAD' || !upstream.body) {
    return new Response(null, { status: upstream.status, headers });
  }

  const contentType = upstream.headers.get('content-type') ?? '';
  const lower = contentType.toLowerCase();
  const shouldLog =
    lower.includes('application/json') || lower.includes('text/event-stream');

  const body = shouldLog
    ? upstream.body.pipeThrough(createLoggingStream(contentType, reqId))
    : upstream.body;

  return new Response(body, { status: upstream.status, headers });
}
