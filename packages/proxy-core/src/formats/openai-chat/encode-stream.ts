import type { CanonicalEvent, Usage } from '@proxitor/plugin-api';
import { createEventSequenceNormalizer } from '../shared/event-normalizer.js';
import { formatSseEvent } from '../shared/sse-serializer.js';
import { REVERSE_STOP } from '../shared/stop-reasons.js';
import type { StreamEncodeOptions, StreamEncoder } from '../shared/stream-codec.js';

export function createOpenAiStreamEncoder(options: StreamEncodeOptions): StreamEncoder {
  const normalizer = createEventSequenceNormalizer({
    model: options.model,
    random: options.random,
  });
  let id = `chatcmpl-${options.random.uuid()}`;
  let model = options.model;
  const created = Math.floor(options.clock.now() / 1000);
  const irToToolIndex = new Map<number, number>();
  let nextToolIndex = 0;
  let usage: Usage | undefined;

  function chunk(
    delta: Record<string, unknown>,
    finishReason: string | null = null,
  ): string {
    return formatSseEvent({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    });
  }

  function usageChunk(): string {
    if (usage === undefined) return '';
    const promptTokens = usage.inputTokens;
    const completionTokens = usage.outputTokens;
    return formatSseEvent({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
        ...(usage.cacheReadTokens !== undefined
          ? { prompt_tokens_details: { cached_tokens: usage.cacheReadTokens } }
          : {}),
      },
    });
  }

  function serialize(event: CanonicalEvent): string {
    switch (event.type) {
      case 'message_start':
        id = event.id;
        model = event.model;
        return chunk({ role: 'assistant' });
      case 'content_block_start':
        if (event.block.type === 'tool_use') {
          const toolIndex = nextToolIndex;
          nextToolIndex += 1;
          irToToolIndex.set(event.index, toolIndex);
          return chunk({
            tool_calls: [
              {
                index: toolIndex,
                id: event.block.id ?? '',
                type: 'function',
                function: { name: event.block.name ?? '', arguments: '' },
              },
            ],
          });
        }
        return '';
      case 'content_block_delta':
        if (event.delta.type === 'text') return chunk({ content: event.delta.text });
        if (event.delta.type === 'thinking')
          return chunk({ reasoning_content: event.delta.thinking });
        return chunk({
          tool_calls: [
            {
              index: irToToolIndex.get(event.index) ?? 0,
              function: { arguments: event.delta.partialJson },
            },
          ],
        });
      case 'signature_delta':
        return ''; // no openai equivalent — dropped by design
      case 'content_block_stop':
        return '';
      case 'message_delta': {
        const wire = event.extensions?.$wire as Record<string, unknown> | undefined;
        const finish =
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
        return chunk({}, finish);
      }
      case 'message_stop':
        return `${usageChunk()}data: [DONE]\n\n`;
      case 'ping':
        return ': ping\n\n';
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
        return '';
      case 'error':
        return formatSseEvent({
          error: {
            message: event.error.message,
            type: event.error.type,
            code: event.error.status,
          },
        });
    }
  }

  return {
    push(event: CanonicalEvent): string {
      if (event.type === 'ping') {
        return serialize(event);
      }
      return normalizer.push([event]).map(serialize).join('');
    },
    end(): string {
      return normalizer.end().map(serialize).join('');
    },
  } as { push(event: CanonicalEvent): string; end(): string };
}
