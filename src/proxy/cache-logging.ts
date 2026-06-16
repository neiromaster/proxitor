import { logger, withReq } from '../logger.js';
import { dumpEnabled, dumpResponse } from './body-dump.js';
import { buildResponseHeaders } from './headers.js';

/** @internal */
export type CacheUsage = {
  cacheRead: number;
  cacheCreate: number;
  inputTokens: number;
};

function applyOpenAIDetails(
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

function applyAnthropicUsage(usage: Record<string, unknown>, result: CacheUsage): void {
  if (
    typeof usage.cache_read_input_tokens === 'number' &&
    (usage.cache_read_input_tokens as number) > 0
  ) {
    result.cacheRead = usage.cache_read_input_tokens as number;
  }
  if (
    typeof usage.cache_creation_input_tokens === 'number' &&
    (usage.cache_creation_input_tokens as number) > 0
  ) {
    result.cacheCreate = usage.cache_creation_input_tokens as number;
  }
  // input_tokens excludes cache; reconstruct the full total.
  if (typeof usage.input_tokens === 'number' && (usage.input_tokens as number) > 0) {
    result.inputTokens =
      (usage.input_tokens as number) + result.cacheRead + result.cacheCreate;
  }
}

function applyOpenAIUsage(usage: Record<string, unknown>, result: CacheUsage): void {
  const promptDetails = usage.prompt_tokens_details;
  if (typeof promptDetails === 'object' && promptDetails !== null) {
    applyOpenAIDetails(promptDetails as Record<string, unknown>, result);
  }

  // Responses API: input_tokens_details (skip if Chat Completions already reported cache).
  if (result.cacheRead === 0 && result.cacheCreate === 0) {
    const inputDetails = usage.input_tokens_details;
    if (typeof inputDetails === 'object' && inputDetails !== null) {
      applyOpenAIDetails(inputDetails as Record<string, unknown>, result);
    }
  }

  if (typeof usage.prompt_tokens === 'number' && (usage.prompt_tokens as number) > 0) {
    result.inputTokens = usage.prompt_tokens as number;
  } else if (
    typeof usage.input_tokens === 'number' &&
    (usage.input_tokens as number) > 0
  ) {
    result.inputTokens = usage.input_tokens as number;
  }
}

function extractFromUsage(usage: Record<string, unknown>, result: CacheUsage): void {
  const isAnthropic =
    typeof usage.cache_read_input_tokens === 'number' ||
    typeof usage.cache_creation_input_tokens === 'number';

  if (isAnthropic) {
    applyAnthropicUsage(usage, result);
  } else {
    applyOpenAIUsage(usage, result);
  }
}

/** @internal */
export function extractCacheUsage(bodyText: string): CacheUsage | undefined {
  try {
    const parsed = JSON.parse(bodyText);
    if (typeof parsed !== 'object' || parsed === null) return undefined;

    const usage = parsed.usage;
    if (typeof usage !== 'object' || usage === null) return undefined;

    const result: CacheUsage = { cacheRead: 0, cacheCreate: 0, inputTokens: 0 };
    extractFromUsage(usage, result);
    return result;
  } catch {
    return undefined;
  }
}

function extractFromEvent(parsed: unknown, result: CacheUsage): boolean {
  if (typeof parsed !== 'object' || parsed === null) return false;

  // Provider-specific SSE wrappers: Anthropic uses { message }, Responses uses { response }, Chat Completions is bare.
  const record = parsed as Record<string, unknown>;
  const container = record.message ?? record.response ?? parsed;
  const usage = (container as Record<string, unknown>).usage;
  if (typeof usage !== 'object' || usage === null) return false;

  const before = result.cacheRead + result.cacheCreate;
  extractFromUsage(usage as Record<string, unknown>, result);
  const after = result.cacheRead + result.cacheCreate;

  return after > before;
}

/** @internal */
export function extractCacheUsageFromSSE(fullText: string): CacheUsage | undefined {
  const result: CacheUsage = { cacheRead: 0, cacheCreate: 0, inputTokens: 0 };
  let found = false;

  for (const line of fullText.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') continue;

    try {
      if (extractFromEvent(JSON.parse(payload), result)) found = true;
    } catch {}
  }

  return found ? result : undefined;
}

function formatCacheUsage(usage: CacheUsage, reqId: string): void {
  const parts: string[] = [];
  if (usage.cacheRead > 0) parts.push(`read: ${usage.cacheRead}`);
  if (usage.cacheCreate > 0) parts.push(`write: ${usage.cacheCreate}`);

  const pct =
    usage.inputTokens > 0 && usage.cacheRead > 0
      ? ` (${((usage.cacheRead / usage.inputTokens) * 100).toFixed(1)}% hit)`
      : '';

  logger.info(
    withReq(
      reqId,
      parts.length > 0
        ? `Cache ${parts.join(', ')} tokens${pct}`
        : 'Cache: no cached tokens',
    ),
  );
}

function createLoggingStream(
  contentType: string,
  reqId: string,
  status: number,
): TransformStream<Uint8Array, Uint8Array> {
  const isDumpEnabled = dumpEnabled();
  const isSSE = contentType.toLowerCase().includes('text/event-stream');
  // Buffer everything if dumping is enabled, or if it's a non-SSE (single JSON) response.
  // For SSE without dumping, we only keep a rolling tail to achieve O(1) memory usage.
  const chunks: Uint8Array[] =
    isDumpEnabled || !isSSE ? [] : ([] as unknown as Uint8Array[]);
  let tailText = '';

  return new TransformStream({
    transform(
      chunk: Uint8Array,
      controller: TransformStreamDefaultController<Uint8Array>,
    ) {
      controller.enqueue(chunk);
      if (isDumpEnabled || !isSSE) {
        chunks.push(chunk);
      } else {
        const decoder = new TextDecoder();
        tailText += decoder.decode(chunk, { stream: true });
        // Keep only the last 4KB to stay O(1) memory.
        // This is more than enough to capture the final 'usage' payload in SSE streams.
        if (tailText.length > 4096) {
          tailText = tailText.slice(-4096);
        }
      }
    },
    flush() {
      try {
        let text = '';
        if (isDumpEnabled || !isSSE) {
          const decoder = new TextDecoder();
          text = chunks.reduce(
            (acc, chunk) => acc + decoder.decode(chunk, { stream: true }),
            '',
          );
          text += decoder.decode();
        } else {
          const decoder = new TextDecoder();
          // Prepend newline to ensure the first (potentially truncated) line doesn't break JSON parsing
          // The try/catch in extractCacheUsageFromSSE safely ignores broken leading lines.
          text = '\n' + tailText + decoder.decode();
        }

        const usage = isSSE ? extractCacheUsageFromSSE(text) : extractCacheUsage(text);

        if (usage) {
          formatCacheUsage(usage, reqId);
        }
        if (isDumpEnabled) {
          dumpResponse(reqId, status, usage);
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
    ? upstream.body.pipeThrough(createLoggingStream(contentType, reqId, upstream.status))
    : upstream.body;

  return new Response(body, { status: upstream.status, headers });
}
