import { logger, withReq } from '../logger.js';
import { buildResponseHeaders } from './headers.js';

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
  // input_tokens is the uncached portion; total = uncached + cache_read + cache_creation.
  if (typeof usage.input_tokens === 'number' && (usage.input_tokens as number) > 0) {
    result.inputTokens =
      (usage.input_tokens as number) + result.cacheRead + result.cacheCreate;
  }
}

function applyOpenAIUsage(usage: Record<string, unknown>, result: CacheUsage): void {
  // Chat Completions / OpenRouter: prompt_tokens_details
  const promptDetails = usage.prompt_tokens_details;
  if (typeof promptDetails === 'object' && promptDetails !== null) {
    applyOpenAIDetails(promptDetails as Record<string, unknown>, result);
  }

  // Responses API: input_tokens_details (only if cache not already found)
  if (result.cacheRead === 0 && result.cacheCreate === 0) {
    const inputDetails = usage.input_tokens_details;
    if (typeof inputDetails === 'object' && inputDetails !== null) {
      applyOpenAIDetails(inputDetails as Record<string, unknown>, result);
    }
  }

  // Total input: prompt_tokens (Chat Completions) or input_tokens (Responses API)
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

  // Anthropic SSE: { message: { usage: {...} } }
  // Responses API SSE: { response: { usage: {...} } }
  // OpenAI Chat Completions SSE: { usage: {...} } (no wrapper)
  const record = parsed as Record<string, unknown>;
  const container = record.message ?? record.response ?? parsed;
  const usage = (container as Record<string, unknown>).usage;
  if (typeof usage !== 'object' || usage === null) return false;

  const before = result.cacheRead + result.cacheCreate;
  extractFromUsage(usage as Record<string, unknown>, result);
  const after = result.cacheRead + result.cacheCreate;

  return after > before;
}

export function extractCacheUsageFromSSE(fullText: string): CacheUsage | undefined {
  const result: CacheUsage = { cacheRead: 0, cacheCreate: 0, inputTokens: 0 };
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
