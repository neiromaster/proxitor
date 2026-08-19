import type { CanonicalEvent, StopReason } from '@proxitor/plugin-api';
import { parseJsonBody } from '../shared/format-error.js';
import { asArray, asObject, asString } from '../shared/validate.js';
import { toOpenAiUsage } from './decode-stream.js';

const STOP_MAP: Record<string, StopReason> = {
  stop: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
  function_call: 'tool_use',
  content_filter: 'end_turn',
};

export function decodeOpenAiResponse(body: string): CanonicalEvent[] {
  const completion = parseJsonBody(body);
  const choice = asObject(asArray(completion.choices, 'choices')[0] ?? {}, 'choices[0]');
  const message = asObject(choice.message ?? {}, 'choices[0].message');
  const events: CanonicalEvent[] = [
    {
      type: 'message_start',
      id: asString(completion.id, 'id'),
      model: asString(completion.model, 'model'),
    },
  ];
  let index = 0;
  if (typeof message.reasoning_content === 'string' && message.reasoning_content !== '') {
    const irBlock: { type: 'thinking'; text?: string } = { type: 'thinking' };
    events.push({ type: 'content_block_start', index, block: irBlock });
    events.push({
      type: 'content_block_delta',
      index,
      delta: { type: 'thinking', thinking: message.reasoning_content },
    });
    events.push({ type: 'content_block_stop', index });
    index += 1;
  }
  if (typeof message.content === 'string' && message.content !== '') {
    const irBlock: { type: 'text'; text?: string } = { type: 'text', text: '' };
    events.push({ type: 'content_block_start', index, block: irBlock });
    events.push({
      type: 'content_block_delta',
      index,
      delta: { type: 'text', text: message.content },
    });
    events.push({ type: 'content_block_stop', index });
    index += 1;
  }
  for (const rawCall of asArray(message.tool_calls ?? [], 'tool_calls')) {
    const call = asObject(rawCall, 'tool_calls entry');
    const fn = asObject(call.function ?? {}, 'tool_calls function');
    events.push({
      type: 'content_block_start',
      index,
      block: {
        type: 'tool_use',
        id: asString(call.id, 'tool_calls id'),
        name: asString(fn.name, 'tool_calls name'),
      },
    });
    events.push({
      type: 'content_block_delta',
      index,
      delta: {
        type: 'input_json',
        partialJson:
          typeof fn.arguments === 'string'
            ? fn.arguments
            : JSON.stringify(fn.arguments ?? {}),
      },
    });
    events.push({ type: 'content_block_stop', index });
    index += 1;
  }
  const raw =
    choice.finish_reason === undefined || choice.finish_reason === null
      ? 'stop'
      : asString(choice.finish_reason, 'finish_reason');
  const canonical = STOP_MAP[raw] ?? 'end_turn';
  events.push({
    type: 'message_delta',
    stopReason: canonical,
    extensions: { $wire: { finish_reason: raw } },
  });
  const usage = toOpenAiUsage(completion.usage);
  if (usage !== undefined) events.push({ type: 'usage', usage });
  events.push({ type: 'message_stop' });
  return events;
}
