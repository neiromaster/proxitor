// src/proxy/observability/extract.ts
import type { Extracted, ExtractedUsage, RoutingMetadata } from './types.js';

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function applyAnthropic(usage: Record<string, unknown>, r: ExtractedUsage): void {
  const cr = num(usage.cache_read_input_tokens);
  const cc = num(usage.cache_creation_input_tokens);
  if (cr !== undefined) r.cacheRead = cr;
  if (cc !== undefined) r.cacheCreate = cc;
  const inp = num(usage.input_tokens);
  if (inp !== undefined) r.inputTokens = inp + r.cacheRead + r.cacheCreate;
}

function applyOpenAI(usage: Record<string, unknown>, r: ExtractedUsage): void {
  const details = (usage.prompt_tokens_details ?? usage.input_tokens_details) as
    | Record<string, unknown>
    | undefined;
  if (details && typeof details === 'object') {
    const cached = num(details.cached_tokens);
    if (cached !== undefined) r.cacheRead = cached;
    const write = num(details.cache_write_tokens);
    if (write !== undefined) r.cacheCreate = write;
  }
  const prompt = num(usage.prompt_tokens) ?? num(usage.input_tokens);
  if (prompt !== undefined) r.inputTokens = prompt;
}

/** Find the usage object, unwrapping Anthropic `message`/`response` SSE containers. */
function usageObject(
  parsed: Record<string, unknown>,
): Record<string, unknown> | undefined {
  for (const c of [parsed.message, parsed.response, parsed]) {
    if (c && typeof c === 'object' && 'usage' in c) {
      const u = (c as Record<string, unknown>).usage;
      if (u && typeof u === 'object') return u as Record<string, unknown>;
    }
  }
  return undefined;
}

export function parseUsage(parsed: unknown): ExtractedUsage | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const usage = usageObject(parsed as Record<string, unknown>);
  if (usage === undefined) return undefined;
  const r: ExtractedUsage = {
    present: true,
    inputTokens: 0,
    cacheRead: 0,
    cacheCreate: 0,
  };
  if ('cache_read_input_tokens' in usage || 'cache_creation_input_tokens' in usage)
    applyAnthropic(usage, r);
  else applyOpenAI(usage, r);
  return r;
}

export function parseRouting(parsed: unknown): RoutingMetadata | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const root = parsed as Record<string, unknown>;
  const meta = (root.openrouter_metadata ??
    (root.message as Record<string, unknown> | undefined)?.openrouter_metadata) as
    | Record<string, unknown>
    | undefined;
  if (!meta || typeof meta !== 'object') return undefined;
  let provider: string | undefined;
  const endpoints = meta.endpoints as
    | { available?: Array<{ provider?: string; selected?: boolean }> }
    | undefined;
  const avail = endpoints?.available;
  if (Array.isArray(avail))
    provider = avail.find(e => e?.selected === true)?.provider ?? avail[0]?.provider;
  const attempts = meta.attempts as Array<{ provider?: string }> | undefined;
  if (provider === undefined && Array.isArray(attempts) && attempts.length > 0)
    provider = attempts[attempts.length - 1]?.provider;
  if (provider === undefined) return undefined;
  const attempt = num(meta.attempt) ?? 1;
  const generationId = typeof root.id === 'string' ? root.id : undefined;
  return {
    provider,
    strategy: typeof meta.strategy === 'string' ? meta.strategy : 'unknown',
    region: typeof meta.region === 'string' ? meta.region : undefined,
    attempt,
    fallback: attempt > 1,
    generationId,
  };
}

function fold(parsed: unknown, acc: Extracted): void {
  const u = parseUsage(parsed);
  if (u) {
    // Last wins — but only when the incoming usage carries input-side signal.
    // Anthropic streams emit input/cache fields in message_start and only
    // output_tokens in the terminal message_delta; a delta with no input-side
    // data must not clobber the authoritative start usage.
    const hasInputSignal = u.inputTokens > 0 || u.cacheRead > 0 || u.cacheCreate > 0;
    if (hasInputSignal || !acc.usage) acc.usage = u;
  }
  const rt = parseRouting(parsed);
  if (rt) acc.routing = rt;
}

export function extractFromFullText(text: string, isSSE: boolean): Extracted {
  if (!isSSE) {
    try {
      const parsed = JSON.parse(text);
      return { usage: parseUsage(parsed), routing: parseRouting(parsed) };
    } catch {
      return {};
    }
  }
  const acc: Extracted = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === '' || payload === '[DONE]') continue;
    try {
      fold(JSON.parse(payload), acc);
    } catch {
      /* skip malformed */
    }
  }
  return acc;
}

/** Stateful fold over an SSE byte stream — O(1) memory, fragmentation-safe. */
export class SseUsageAccumulator {
  private buffer = '';
  private readonly decoder = new TextDecoder();
  private readonly acc: Extracted = {};

  feed(chunk: Uint8Array): void {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    let nl = this.buffer.indexOf('\n');
    while (nl !== -1) {
      this.process(this.buffer.slice(0, nl));
      this.buffer = this.buffer.slice(nl + 1);
      nl = this.buffer.indexOf('\n');
    }
  }

  result(): Extracted {
    this.buffer += this.decoder.decode(); // flush decoder
    if (this.buffer.length > 0) this.process(this.buffer);
    this.buffer = '';
    return this.acc;
  }

  private process(line: string): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (payload === '' || payload === '[DONE]') return;
    try {
      fold(JSON.parse(payload), this.acc);
    } catch {
      /* skip malformed */
    }
  }
}
