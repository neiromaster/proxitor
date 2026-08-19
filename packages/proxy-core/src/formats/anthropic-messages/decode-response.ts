import type { CanonicalEvent, StopReason } from '@proxitor/plugin-api';
import { parseJsonBody } from '../shared/format-error.js';
import { asArray, asObject, asString } from '../shared/validate.js';
import { toUsage } from './usage.js';

const CANONICAL_STOP_REASONS = new Set<string>([
  'end_turn',
  'max_tokens',
  'stop_sequence',
  'tool_use',
]);

export function decodeAnthropicResponse(body: string): CanonicalEvent[] {
  const message = parseJsonBody(body);
  const events: CanonicalEvent[] = [
    {
      type: 'message_start',
      id: asString(message.id, 'id'),
      model: asString(message.model, 'model'),
    },
  ];
  const content = asArray(message.content ?? [], 'content');
  content.forEach((entry, index) => {
    const block = asObject(entry, 'content entry');
    switch (block.type) {
      case 'text': {
        const irBlock: { type: 'text'; text?: string } = { type: 'text', text: '' };
        events.push({
          type: 'content_block_start',
          index,
          block: irBlock,
        });
        events.push({
          type: 'content_block_delta',
          index,
          delta: { type: 'text', text: asString(block.text, 'text') },
        });
        events.push({ type: 'content_block_stop', index });
        break;
      }
      case 'thinking':
        events.push({ type: 'content_block_start', index, block: { type: 'thinking' } });
        events.push({
          type: 'content_block_delta',
          index,
          delta: { type: 'thinking', thinking: asString(block.thinking, 'thinking') },
        });
        events.push({
          type: 'signature_delta',
          index,
          signature: typeof block.signature === 'string' ? block.signature : '',
        });
        events.push({ type: 'content_block_stop', index });
        break;
      case 'tool_use':
        events.push({
          type: 'content_block_start',
          index,
          block: {
            type: 'tool_use',
            id: asString(block.id, 'tool_use id'),
            name: asString(block.name, 'tool_use name'),
          },
        });
        events.push({
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json', partialJson: JSON.stringify(block.input ?? {}) },
        });
        events.push({ type: 'content_block_stop', index });
        break;
      default:
        break; // unknown assistant block types are dropped in non-stream decode (spec §4.2 note)
    }
  });
  const raw = typeof message.stop_reason === 'string' ? message.stop_reason : undefined;
  const canonical: StopReason =
    raw !== undefined && CANONICAL_STOP_REASONS.has(raw)
      ? (raw as StopReason)
      : 'end_turn';
  const deltaEvent: CanonicalEvent =
    raw !== undefined && raw !== canonical
      ? {
          type: 'message_delta',
          stopReason: canonical,
          stopSequence: null,
          extensions: { $wire: { stopReason: raw } },
        }
      : { type: 'message_delta', stopReason: canonical, stopSequence: null };
  events.push(deltaEvent);
  const usage = toUsage(message.usage);
  if (usage !== undefined) events.push({ type: 'usage', usage });
  events.push({ type: 'message_stop' });
  return events;
}
