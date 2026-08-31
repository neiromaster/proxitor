import { describe, expect, test } from 'vitest';
import { expectSameJson } from '../test-utils.js';
import { decodeAnthropicResponse } from './decode-response.js';
import { encodeAnthropicResponse } from './encode-response.js';

const body = JSON.stringify({
  id: 'msg_01X',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-4-5',
  content: [
    { type: 'thinking', thinking: 'pondering', signature: 'sig1' },
    { type: 'text', text: 'Answer' },
    { type: 'tool_use', id: 'toolu_02B', name: 'lookup', input: { q: 'x' } },
  ],
  stop_reason: 'tool_use',
  stop_sequence: null,
  usage: { input_tokens: 30, output_tokens: 12, cache_read_input_tokens: 5 },
});

describe('non-stream anthropic response codec', () => {
  test('decodes a message into a canonical event sequence', () => {
    // Act
    const events = decodeAnthropicResponse(body);
    // Assert
    expect(events).toEqual([
      { type: 'message_start', id: 'msg_01X', model: 'claude-sonnet-4-5' },
      { type: 'content_block_start', index: 0, block: { type: 'thinking' } },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking', thinking: 'pondering' },
      },
      { type: 'signature_delta', index: 0, signature: 'sig1' },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text', text: 'Answer' } },
      { type: 'content_block_stop', index: 1 },
      {
        type: 'content_block_start',
        index: 2,
        block: { type: 'tool_use', id: 'toolu_02B', name: 'lookup' },
      },
      {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'input_json', partialJson: '{"q":"x"}' },
      },
      { type: 'content_block_stop', index: 2 },
      { type: 'message_delta', stopReason: 'tool_use', stopSequence: null },
      { type: 'usage', usage: { inputTokens: 30, outputTokens: 12, cacheReadTokens: 5 } },
      { type: 'message_stop' },
    ]);
  });

  test('round-trips the body modulo JSON canonicalization', () => {
    // Act
    const encoded = encodeAnthropicResponse(decodeAnthropicResponse(body));
    // Assert
    expectSameJson(encoded, body);
  });
});
