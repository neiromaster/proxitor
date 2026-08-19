import type { CanonicalEvent, Usage } from '@proxitor/plugin-api';
import { createEventSequenceNormalizer } from '../shared/event-normalizer.js';
import { FormatError } from '../shared/format-error.js';
import type { StreamEncodeOptions } from '../shared/stream-codec.js';

const REVERSE_STOP: Record<string, string> = {
  end_turn: 'stop',
  max_tokens: 'length',
  tool_use: 'tool_calls',
  stop_sequence: 'stop',
};

export function encodeOpenAiResponse(
  events: Iterable<CanonicalEvent>,
  options: StreamEncodeOptions,
): string {
  const normalizer = createEventSequenceNormalizer({
    model: options.model,
    random: options.random,
  });
  const normalized = [...normalizer.push([...events]), ...normalizer.end()];

  let id = `chatcmpl-${options.random.uuid()}`;
  let model = options.model;
  let text = '';
  let reasoning = '';
  const tools: { index: number; id: string; name: string; args: string }[] = [];
  const open = new Map<
    number,
    { tool?: { index: number; id: string; name: string; args: string } }
  >();
  let finish: string | undefined;
  let usage: Usage | undefined;

  for (const event of normalized) {
    switch (event.type) {
      case 'message_start':
        id = event.id;
        model = event.model;
        break;
      case 'content_block_start':
        if (event.block.type === 'tool_use') {
          const tool = {
            index: tools.length,
            id: event.block.id ?? '',
            name: event.block.name ?? '',
            args: '',
          };
          tools.push(tool);
          open.set(event.index, { tool });
        } else {
          open.set(event.index, {});
        }
        break;
      case 'content_block_delta': {
        const slot = open.get(event.index);
        if (event.delta.type === 'text') text += event.delta.text;
        else if (event.delta.type === 'thinking') reasoning += event.delta.thinking;
        else if (slot?.tool !== undefined) slot.tool.args += event.delta.partialJson;
        break;
      }
      case 'signature_delta':
        break; // dropped by design
      case 'content_block_stop':
        open.delete(event.index);
        break;
      case 'message_delta': {
        const wire = event.extensions?.$wire as Record<string, unknown> | undefined;
        finish =
          (typeof wire?.finish_reason === 'string'
            ? wire.finish_reason
            : REVERSE_STOP[event.stopReason ?? 'end_turn']) ?? 'stop';
        if (event.usage?.outputTokens !== undefined) {
          usage = {
            ...usage,
            inputTokens: usage?.inputTokens ?? 0,
            outputTokens: event.usage.outputTokens,
          };
        }
        break;
      }
      case 'usage':
        usage = {
          inputTokens: event.usage.inputTokens,
          outputTokens: event.usage.outputTokens,
          ...(event.usage.cacheReadTokens !== undefined
            ? { cacheReadTokens: event.usage.cacheReadTokens }
            : {}),
          ...(event.usage.cacheCreateTokens !== undefined
            ? { cacheCreateTokens: event.usage.cacheCreateTokens }
            : {}),
        };
        break;
      case 'error':
        throw new FormatError(event.error);
      default:
        break;
    }
  }

  const message: Record<string, unknown> = {
    role: 'assistant',
    content: text === '' && tools.length > 0 ? null : text,
    ...(reasoning !== '' ? { reasoning_content: reasoning } : {}),
    ...(tools.length > 0
      ? {
          tool_calls: tools.map(tool => ({
            id: tool.id,
            type: 'function',
            function: { name: tool.name, arguments: tool.args === '' ? '{}' : tool.args },
          })),
        }
      : {}),
  };
  return JSON.stringify({
    id,
    object: 'chat.completion',
    created: Math.floor(options.clock.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: finish ?? 'stop' }],
    usage:
      usage === undefined
        ? {}
        : {
            prompt_tokens: usage.inputTokens,
            completion_tokens: usage.outputTokens,
            total_tokens: usage.inputTokens + usage.outputTokens,
            ...(usage.cacheReadTokens !== undefined
              ? { prompt_tokens_details: { cached_tokens: usage.cacheReadTokens } }
              : {}),
          },
  });
}
