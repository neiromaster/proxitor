import type { CanonicalEvent, StopReason, Usage } from '@proxitor/plugin-api';
import { invalidRequest } from '../shared/format-error.js';
import { createSseParser } from '../shared/sse-parser.js';
import { asObject, type Json } from '../shared/validate.js';

type OpenBlock = { index: number; kind: 'text' | 'thinking' | 'tool_use' };

const STOP_MAP: Record<string, StopReason> = {
  stop: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
  function_call: 'tool_use',
  content_filter: 'end_turn',
};

export function createOpenAiStreamDecoder() {
  const parser = createSseParser();
  let started = false;
  let stopped = false;
  let nextIndex = 0;
  let open: OpenBlock | undefined; // single open block at a time (single-choice assumption)
  const toolIndexToIr = new Map<number, number>();

  function closeOpen(out: CanonicalEvent[]): void {
    if (open === undefined) return;
    out.push({ type: 'content_block_stop', index: open.index });
    open = undefined;
  }

  function openBlock(
    out: CanonicalEvent[],
    kind: OpenBlock['kind'],
    block?: { id?: string; name?: string },
  ): number {
    const index = nextIndex;
    nextIndex += 1;
    open = { index, kind };
    const irBlock: {
      type: 'text' | 'tool_use' | 'thinking';
      id?: string;
      name?: string;
      text?: string;
    } =
      kind === 'tool_use'
        ? { type: 'tool_use', id: block?.id ?? '', name: block?.name ?? '' }
        : { type: kind };
    if (kind === 'text') irBlock.text = '';
    out.push({
      type: 'content_block_start',
      index,
      block: irBlock,
    });
    return index;
  }

  function handleChunk(wire: Json, out: CanonicalEvent[]): void {
    if (!started) {
      started = true;
      out.push({
        type: 'message_start',
        id: str(wire.id) ?? 'chatcmpl_unknown',
        model: str(wire.model) ?? 'unknown',
      });
    }
    for (const rawChoice of asObjectArray(wire.choices)) {
      const delta =
        rawChoice.delta === undefined || rawChoice.delta === null
          ? {}
          : asObject(rawChoice.delta, 'choices[].delta');
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content !== '') {
        if (open?.kind !== 'thinking') {
          closeOpen(out);
          openBlock(out, 'thinking');
        }
        out.push({
          type: 'content_block_delta',
          index: open!.index,
          delta: { type: 'thinking', thinking: delta.reasoning_content },
        });
      }
      if (typeof delta.content === 'string' && delta.content !== '') {
        if (open?.kind !== 'text') {
          closeOpen(out);
          openBlock(out, 'text');
        }
        out.push({
          type: 'content_block_delta',
          index: open!.index,
          delta: { type: 'text', text: delta.content },
        });
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const rawCall of delta.tool_calls) {
          const call = asObject(rawCall, 'tool_calls entry');
          const callIndex = typeof call.index === 'number' ? call.index : 0;
          const fn =
            call.function === undefined || call.function === null
              ? {}
              : asObject(call.function, 'tool_calls function');
          const args = str(fn.arguments);
          let irIndex = toolIndexToIr.get(callIndex);
          if (irIndex === undefined || open?.kind !== 'tool_use') {
            const id = str(call.id);
            const name = str(fn.name);
            if (id === undefined && name === undefined && args === undefined) continue; // continuation fragment with nothing new
            closeOpen(out);
            irIndex = openBlock(out, 'tool_use', { id: id ?? '', name: name ?? '' });
            toolIndexToIr.set(callIndex, irIndex);
          }
          if (args !== undefined && args !== '') {
            out.push({
              type: 'content_block_delta',
              index: irIndex,
              delta: { type: 'input_json', partialJson: args },
            });
          }
        }
      }
      if (rawChoice.finish_reason !== undefined && rawChoice.finish_reason !== null) {
        closeOpen(out);
        const raw = rawChoice.finish_reason as string;
        const canonical = STOP_MAP[raw] ?? 'end_turn';
        out.push({
          type: 'message_delta',
          stopReason: canonical,
          extensions: { $wire: { finish_reason: raw } },
        });
      }
    }
    const usage = toOpenAiUsage(wire.usage);
    if (usage !== undefined) out.push({ type: 'usage', usage });
  }

  return {
    push(chunk: string): CanonicalEvent[] {
      const out: CanonicalEvent[] = [];
      for (const message of parser.push(chunk)) {
        if (message.data === '[DONE]') {
          closeOpen(out);
          stopped = true;
          out.push({ type: 'message_stop' });
          continue;
        }
        let wire: Json;
        try {
          wire = JSON.parse(message.data) as Json;
        } catch {
          throw invalidRequest('stream data frame is not valid JSON');
        }
        handleChunk(asObject(wire, 'chunk'), out);
      }
      return out;
    },
    end(): CanonicalEvent[] {
      const out: CanonicalEvent[] = [];
      for (const message of parser.end()) {
        if (message.data === '[DONE]') {
          closeOpen(out);
          stopped = true;
          out.push({ type: 'message_stop' });
          continue;
        }
        handleChunk(asObject(JSON.parse(message.data) as Json, 'chunk'), out);
      }
      if (started && !stopped) {
        out.push({
          type: 'error',
          error: {
            type: 'stream_truncated',
            message: 'stream ended without [DONE]',
            status: 502,
          },
        });
      }
      return out;
    },
  };
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asObjectArray(value: unknown): Json[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Json => entry !== null && typeof entry === 'object')
    : [];
}

export function toOpenAiUsage(value: unknown): Usage | undefined {
  if (value === undefined || value === null || typeof value !== 'object')
    return undefined;
  const usage = value as Json;
  const cached =
    usage.prompt_tokens_details !== undefined &&
    usage.prompt_tokens_details !== null &&
    typeof usage.prompt_tokens_details === 'object'
      ? (usage.prompt_tokens_details as Json).cached_tokens
      : undefined;
  return {
    inputTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
    outputTokens:
      typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0,
    ...(typeof cached === 'number' ? { cacheReadTokens: cached } : {}),
  };
}
