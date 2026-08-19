import type { CanonicalEvent } from '@proxitor/plugin-api';
import { createEventSequenceNormalizer } from '../shared/event-normalizer.js';
import { FormatError } from '../shared/format-error.js';

export function encodeAnthropicResponse(events: Iterable<CanonicalEvent>): string {
  const normalizer = createEventSequenceNormalizer({
    model: 'unknown',
    random: { uuid: () => 'synthesized' },
  });
  const normalized = [...normalizer.push([...events]), ...normalizer.end()];

  let id = 'msg_synthesized';
  let model = 'unknown';
  const content: Record<string, unknown>[] = [];
  const open = new Map<number, Record<string, unknown>>();
  let stopReason: string | undefined;
  let stopSequence: string | null = null;
  const usage: Record<string, number> = {};

  for (const event of normalized) {
    switch (event.type) {
      case 'message_start':
        id = event.id;
        model = event.model;
        break;
      case 'content_block_start': {
        let block: Record<string, unknown>;
        if (event.block.type === 'text') {
          block = { type: 'text', text: '' };
        } else if (event.block.type === 'thinking') {
          block = { type: 'thinking', thinking: '', signature: '' };
        } else {
          block = {
            type: 'tool_use',
            id: event.block.id ?? '',
            name: event.block.name ?? '',
            input: {},
          };
        }
        open.set(event.index, block);
        content[event.index] = block;
        break;
      }
      case 'content_block_delta': {
        const block = open.get(event.index);
        if (block === undefined) break;
        if (event.delta.type === 'text')
          block.text = (block.text as string) + event.delta.text;
        else if (event.delta.type === 'thinking')
          block.thinking = (block.thinking as string) + event.delta.thinking;
        else if (block.type === 'tool_use') {
          block.input =
            typeof block.input === 'string'
              ? block.input + event.delta.partialJson
              : event.delta.partialJson;
        }
        break;
      }
      case 'signature_delta': {
        const block = open.get(event.index);
        if (block !== undefined)
          block.signature = (block.signature as string) + event.signature;
        break;
      }
      case 'content_block_stop': {
        const block = open.get(event.index);
        if (
          block !== undefined &&
          block.type === 'tool_use' &&
          typeof block.input === 'string'
        ) {
          block.input = parseToolInput(block.input);
        }
        open.delete(event.index);
        break;
      }
      case 'message_delta': {
        const raw = event.extensions?.['$wire'] as Record<string, unknown> | undefined;
        stopReason =
          typeof raw?.stopReason === 'string' ? raw.stopReason : event.stopReason;
        if (event.stopSequence !== null && event.stopSequence !== undefined)
          stopSequence = event.stopSequence;
        if (event.usage?.outputTokens !== undefined)
          usage.output_tokens = event.usage.outputTokens;
        break;
      }
      case 'usage':
        usage.input_tokens = event.usage.inputTokens;
        if (usage.output_tokens === undefined)
          usage.output_tokens = event.usage.outputTokens;
        if (event.usage.cacheReadTokens !== undefined)
          usage.cache_read_input_tokens = event.usage.cacheReadTokens;
        if (event.usage.cacheCreateTokens !== undefined)
          usage.cache_creation_input_tokens = event.usage.cacheCreateTokens;
        break;
      case 'error':
        throw new FormatError(event.error);
      default:
        break;
    }
  }
  return JSON.stringify({
    id,
    type: 'message',
    role: 'assistant',
    model,
    content: content.filter(block => block !== undefined),
    stop_reason: stopReason ?? 'end_turn',
    stop_sequence: stopSequence,
    usage,
  });
}

function parseToolInput(raw: string): Record<string, unknown> {
  if (raw === '') return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { _raw: raw }; // malformed accumulated tool JSON is preserved, not lost (encoder never crashes, spec §4.4)
  }
}
