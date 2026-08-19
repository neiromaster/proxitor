import type { CanonicalEvent, NodeExtensions, RandomPort } from '@proxitor/plugin-api';
import { createEventSequenceNormalizer } from '../shared/event-normalizer.js';
import { formatSseEvent } from '../shared/sse-serializer.js';

export function createAnthropicStreamEncoder(options: {
  model: string;
  random: RandomPort;
}): { push(event: CanonicalEvent): string; end(): string } {
  const normalizer = createEventSequenceNormalizer(options);

  function serialize(event: CanonicalEvent): string {
    switch (event.type) {
      case 'message_start':
        return formatSseEvent(
          {
            type: 'message_start',
            message: {
              id: event.id,
              model: event.model,
              usage: { input_tokens: 0, output_tokens: 0 },
            },
          },
          'message_start',
        );
      case 'content_block_start':
        return formatSseEvent(
          { type: 'content_block_start', index: event.index, content_block: event.block },
          'content_block_start',
        );
      case 'content_block_delta': {
        let delta: Record<string, unknown>;
        if (event.delta.type === 'text') {
          delta = { type: 'text_delta', text: event.delta.text };
        } else if (event.delta.type === 'input_json') {
          delta = { type: 'input_json_delta', partial_json: event.delta.partialJson };
        } else {
          delta = { type: 'thinking_delta', thinking: event.delta.thinking };
        }
        return formatSseEvent(
          { type: 'content_block_delta', index: event.index, delta },
          'content_block_delta',
        );
      }
      case 'signature_delta':
        return formatSseEvent(
          { type: 'signature_delta', index: event.index, signature: event.signature },
          'signature_delta',
        );
      case 'content_block_stop':
        return formatSseEvent(
          { type: 'content_block_stop', index: event.index },
          'content_block_stop',
        );
      case 'message_delta': {
        const raw = readRawStopReason(event.extensions);
        const delta: Record<string, unknown> = {};
        if (event.stopReason !== undefined) delta.stop_reason = raw ?? event.stopReason;
        if (event.stopSequence !== undefined) delta.stop_sequence = event.stopSequence;
        const payload: Record<string, unknown> = { type: 'message_delta', delta };
        if (event.usage?.outputTokens !== undefined)
          payload.usage = { output_tokens: event.usage.outputTokens };
        return formatSseEvent(payload, 'message_delta');
      }
      case 'message_stop':
        return formatSseEvent({ type: 'message_stop' }, 'message_stop');
      case 'ping':
        return formatSseEvent({ type: 'ping' }, 'ping');
      case 'usage': {
        const usage: Record<string, unknown> = {
          output_tokens: event.usage.outputTokens,
        };
        if (event.usage.inputTokens > 0) usage.input_tokens = event.usage.inputTokens;
        if (event.usage.cacheReadTokens !== undefined)
          usage.cache_read_input_tokens = event.usage.cacheReadTokens;
        if (event.usage.cacheCreateTokens !== undefined)
          usage.cache_creation_input_tokens = event.usage.cacheCreateTokens;
        return formatSseEvent(
          { type: 'message_delta', delta: {}, usage },
          'message_delta',
        );
      }
      case 'error':
        return formatSseEvent(
          {
            type: 'error',
            error: { type: event.error.type, message: event.error.message },
          },
          'error',
        );
    }
  }

  return {
    push(event: CanonicalEvent): string {
      return normalizer.push([event]).map(serialize).join('');
    },
    end(): string {
      return normalizer.end().map(serialize).join('');
    },
  };
}

function readRawStopReason(extensions: NodeExtensions | undefined): string | undefined {
  const wireExt = extensions?.$wire as Record<string, unknown> | undefined;
  return wireExt !== undefined && typeof wireExt.stopReason === 'string'
    ? wireExt.stopReason
    : undefined;
}
