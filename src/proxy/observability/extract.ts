// src/proxy/observability/extract.ts
import type { Extracted, ExtractedUsage, RoutingMetadata } from './types.js';

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** First non-empty string among the candidates — resolves a generation id that
 * may live at the root or nested under message/response SSE containers. */
function firstStringId(vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function applyAnthropic(
  usage: Record<string, unknown>,
  r: ExtractedUsage,
  cr: number | undefined,
  cc: number | undefined,
): void {
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
  // Route by NUMERIC Anthropic fields, not mere key presence: a key set to
  // null/string would otherwise take the Anthropic branch (which then no-ops)
  // and skip the OpenAI cached_tokens path — losing a real cache hit.
  const cr = num(usage.cache_read_input_tokens);
  const cc = num(usage.cache_creation_input_tokens);
  if (cr !== undefined || cc !== undefined) applyAnthropic(usage, r, cr, cc);
  else applyOpenAI(usage, r);
  return r;
}

/** Resolve the provider from endpoints[].available (selected first) then the
 * last attempts[] entry. An empty/absent provider string defers to the next
 * source — '' is treated as absent, not a real value. */
function resolveProvider(meta: Record<string, unknown>): string | undefined {
  const endpoints = meta.endpoints as
    | { available?: Array<{ provider?: string; selected?: boolean }> }
    | undefined;
  const avail = endpoints?.available;
  if (Array.isArray(avail)) {
    const selected = avail.find(e => e.selected === true);
    const selProvider = selected ? selected.provider : avail[0]?.provider;
    if (selProvider) return selProvider;
  }
  const attempts = meta.attempts as Array<{ provider?: string }> | undefined;
  if (Array.isArray(attempts)) {
    const last = attempts.at(-1)?.provider;
    if (last) return last;
  }
  return undefined;
}

export function parseRouting(parsed: unknown): RoutingMetadata | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const root = parsed as Record<string, unknown>;
  const meta = (root.openrouter_metadata ??
    (root.message as Record<string, unknown> | undefined)?.openrouter_metadata ??
    (root.response as Record<string, unknown> | undefined)?.openrouter_metadata) as
    | Record<string, unknown>
    | undefined;
  if (!meta || typeof meta !== 'object') return undefined;
  const provider = resolveProvider(meta);
  if (!provider) return undefined;
  const attempt = num(meta.attempt) ?? 1;
  // The generation id sits at the root for Chat Completions, but under
  // message.id / response.id for Anthropic / Responses-API SSE shapes — and the
  // metadata event isn't always the one carrying the root id.
  const generationId = firstStringId([
    root.id,
    (root.message as Record<string, unknown> | undefined)?.id,
    (root.response as Record<string, unknown> | undefined)?.id,
  ]);
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
    // Field-level merge: last non-zero value wins per field. inputTokens is
    // updated only when the carrying event had an input-side base, so a
    // terminal Anthropic message_delta (output-only, or cache fields without
    // input_tokens) cannot clobber the authoritative message_start usage.
    if (!acc.usage) {
      acc.usage = { ...u };
    } else {
      const a = acc.usage;
      if (u.cacheRead > 0) a.cacheRead = u.cacheRead;
      if (u.cacheCreate > 0) a.cacheCreate = u.cacheCreate;
      if (u.inputTokens > 0) a.inputTokens = u.inputTokens;
    }
  }
  const rt = parseRouting(parsed);
  if (rt) acc.routing = rt;
}

/** Strip a leading UTF-8 BOM (U+FEFF) — trim() no longer removes it (ES2019). */
function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Parse one SSE `data:` line into the accumulator. Shared by the stateless and streaming folds. */
function parseDataLine(line: string, acc: Extracted): void {
  const trimmed = stripBom(line).trim();
  if (!trimmed.startsWith('data:')) return;
  const payload = trimmed.slice(5).trim();
  if (payload === '' || payload === '[DONE]') return;
  try {
    fold(JSON.parse(payload), acc);
  } catch {
    /* skip malformed */
  }
}

export function extractFromFullText(text: string, isSSE: boolean): Extracted {
  if (!isSSE) {
    try {
      const parsed = JSON.parse(stripBom(text));
      return { usage: parseUsage(parsed), routing: parseRouting(parsed) };
    } catch {
      return {};
    }
  }
  const acc: Extracted = {};
  for (const line of text.split('\n')) parseDataLine(line, acc);
  return acc;
}

/** Stateful fold over an SSE byte stream — O(1) memory, fragmentation-safe. */
export class SseUsageAccumulator {
  private buffer = '';
  private offset = 0;
  // Explicit `boolean` (not inferred from `= false`) so Biome's
  // noUnnecessaryConditions doesn't treat this as a literal-false field and
  // flag the guards below — result() flips it to true, which makes both checks
  // load-bearing for the one-shot contract.
  private done: boolean = false;
  private readonly decoder = new TextDecoder();
  private readonly acc: Extracted = {};

  feed(chunk: Uint8Array): void {
    // result() finalizes this stream; a stray late chunk (e.g. a delayed write
    // after finalize) must be ignored rather than folded into a reset buffer
    // with an already-flushed decoder.
    if (this.done) return;
    this.buffer += this.decoder.decode(chunk, { stream: true });
    let nl = this.buffer.indexOf('\n', this.offset);
    while (nl !== -1) {
      this.process(this.buffer.slice(this.offset, nl));
      this.offset = nl + 1;
      nl = this.buffer.indexOf('\n', this.offset);
    }
    // Drop the processed prefix once per chunk so the buffer holds only the
    // trailing partial line. Without this, slice(nl + 1) in the loop would
    // rebuild the whole tail on every newline — O(n*lines) per chunk.
    if (this.offset > 0) {
      this.buffer = this.buffer.slice(this.offset);
      this.offset = 0;
    }
  }

  result(): Extracted {
    // One-shot: a repeated finalize (the stream's pull/cancel/error paths can
    // each call it) returns the same snapshot without re-processing the buffer
    // or re-flushing an already-flushed decoder.
    if (this.done) return this.acc;
    this.done = true;
    this.buffer += this.decoder.decode(); // flush decoder
    if (this.buffer.length > 0) this.process(this.buffer.slice(this.offset));
    this.buffer = '';
    this.offset = 0;
    return this.acc;
  }

  private process(line: string): void {
    parseDataLine(line, this.acc);
  }
}
