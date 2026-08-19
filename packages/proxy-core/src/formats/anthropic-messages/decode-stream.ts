import type { CanonicalEvent, StopReason } from '@proxitor/plugin-api';
import { invalidRequest } from '../shared/format-error.js';
import { createSseParser } from '../shared/sse-parser.js';
import { asObject, asString, type Json } from '../shared/validate.js';
import { toUsage } from './usage.js';

const CANONICAL_STOP_REASONS = new Set<string>([
  'end_turn',
  'max_tokens',
  'stop_sequence',
  'tool_use',
]);

export function createAnthropicStreamDecoder() {
  const parser = createSseParser();
  let started = false;
  let stopped = false;

  function mapWireEvent(wire: Json): CanonicalEvent[] {
    const out: CanonicalEvent[] = [];
    switch (wire.type) {
      case 'message_start': {
        started = true;
        const message = asObject(wire.message, 'message_start.message');
        out.push({
          type: 'message_start',
          id: asString(message.id, 'message id'),
          model: asString(message.model, 'message model'),
        });
        const usage = toUsage(message.usage);
        if (usage !== undefined && (usage.inputTokens > 0 || usage.outputTokens > 0)) {
          out.push({ type: 'usage', usage });
        }
        break;
      }
      case 'content_block_start': {
        started = true;
        const block = asObject(wire.content_block, 'content_block_start.content_block');
        const irBlock: {
          type: 'text' | 'tool_use' | 'thinking';
          id?: string;
          name?: string;
          text?: string;
        } = { type: 'text' };
        if (block.type === 'tool_use') irBlock.type = 'tool_use';
        else if (block.type === 'thinking') irBlock.type = 'thinking';
        if (typeof block.id === 'string') irBlock.id = block.id;
        if (typeof block.name === 'string') irBlock.name = block.name;
        if (block.type === 'text') irBlock.text = '';
        out.push({
          type: 'content_block_start',
          index: asNumber(wire.index, 'index'),
          block: irBlock,
        });
        break;
      }
      case 'content_block_delta': {
        const delta = asObject(wire.delta, 'content_block_delta.delta');
        if (delta.type === 'text_delta')
          out.push({
            type: 'content_block_delta',
            index: asNumber(wire.index, 'index'),
            delta: { type: 'text', text: asString(delta.text, 'text_delta.text') },
          });
        else if (delta.type === 'input_json_delta')
          out.push({
            type: 'content_block_delta',
            index: asNumber(wire.index, 'index'),
            delta: {
              type: 'input_json',
              partialJson: asString(delta.partial_json, 'partial_json'),
            },
          });
        else if (delta.type === 'thinking_delta')
          out.push({
            type: 'content_block_delta',
            index: asNumber(wire.index, 'index'),
            delta: {
              type: 'thinking',
              thinking: asString(delta.thinking, 'thinking_delta.thinking'),
            },
          });
        break;
      }
      case 'signature_delta':
        out.push({
          type: 'signature_delta',
          index: asNumber(wire.index, 'index'),
          signature: asString(wire.signature, 'signature'),
        });
        break;
      case 'content_block_stop':
        out.push({ type: 'content_block_stop', index: asNumber(wire.index, 'index') });
        break;
      case 'message_delta': {
        started = true;
        const delta = asObject(wire.delta, 'message_delta.delta');
        const hasStop =
          delta.stop_reason !== undefined || delta.stop_sequence !== undefined;
        if (hasStop) {
          const raw =
            typeof delta.stop_reason === 'string' ? delta.stop_reason : undefined;
          const canonical =
            raw !== undefined && CANONICAL_STOP_REASONS.has(raw)
              ? (raw as StopReason)
              : 'end_turn';
          const event: CanonicalEvent = {
            type: 'message_delta',
            ...(raw !== undefined && raw !== canonical
              ? { stopReason: canonical, extensions: { $wire: { stopReason: raw } } }
              : { stopReason: canonical }),
          };
          if (delta.stop_sequence !== undefined && delta.stop_sequence !== null) {
            event.stopSequence = asString(delta.stop_sequence, 'stop_sequence');
          }
          const outputTokens = toPartialUsage(wire.usage);
          if (outputTokens !== undefined) event.usage = { outputTokens };
          out.push(event);
        } else {
          const usage = toUsage(wire.usage);
          if (usage !== undefined) out.push({ type: 'usage', usage });
        }
        break;
      }
      case 'message_stop':
        stopped = true;
        out.push({ type: 'message_stop' });
        break;
      case 'ping':
        out.push({ type: 'ping' });
        break;
      case 'error': {
        stopped = true;
        const error = asObject(wire.error, 'error.error');
        out.push({
          type: 'error',
          error: {
            type: asString(error.type, 'error type'),
            message: asString(error.message, 'error message'),
            status: typeof error.status === 'number' ? error.status : 500,
          },
        });
        break;
      }
      default:
        break; // unknown wire event types pass through as dropped (forward compat)
    }
    return out;
  }

  return {
    push(chunk: string): CanonicalEvent[] {
      const out: CanonicalEvent[] = [];
      for (const message of parser.push(chunk)) {
        let wire: Json;
        try {
          wire = JSON.parse(message.data) as Json;
        } catch (_error) {
          throw invalidRequest('stream data frame is not valid JSON');
        }
        out.push(...mapWireEvent(asObject(wire, 'stream event')));
      }
      return out;
    },
    end(): CanonicalEvent[] {
      const out: CanonicalEvent[] = [];
      for (const message of parser.end()) {
        out.push(
          ...mapWireEvent(asObject(JSON.parse(message.data) as Json, 'stream event')),
        );
      }
      if (started && !stopped) {
        out.push({
          type: 'error',
          error: {
            type: 'stream_truncated',
            message: 'stream ended without message_stop',
            status: 502,
          },
        });
      }
      return out;
    },
  };
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value))
    throw new Error(`expected integer ${field}`);
  return value;
}

function toPartialUsage(value: unknown): number | undefined {
  if (value === undefined || value === null || typeof value !== 'object')
    return undefined;
  const usage = value as Json;
  return typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined;
}
