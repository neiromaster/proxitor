import { describe, expect, test } from 'vitest';
import { decodeOpenAiResponse } from './decode-response.js';

const body = JSON.stringify({
  id: 'chatcmpl-9',
  object: 'chat.completion',
  created: 1755596800,
  model: 'gpt-5',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: 'Answer',
        reasoning_content: 'ponder',
        tool_calls: [
          {
            id: 'call_9',
            type: 'function',
            function: { name: 'lookup', arguments: '{"q":"x"}' },
          },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ],
  usage: {
    prompt_tokens: 30,
    completion_tokens: 12,
    total_tokens: 42,
    prompt_tokens_details: { cached_tokens: 5 },
  },
});

describe('decodeOpenAiResponse', () => {
  test('decodes a completion into canonical events', () => {
    // Act
    const events = decodeOpenAiResponse(body);
    // Assert
    expect(events).toEqual([
      { type: 'message_start', id: 'chatcmpl-9', model: 'gpt-5' },
      { type: 'content_block_start', index: 0, block: { type: 'thinking' } },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking', thinking: 'ponder' },
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text', text: 'Answer' } },
      { type: 'content_block_stop', index: 1 },
      {
        type: 'content_block_start',
        index: 2,
        block: { type: 'tool_use', id: 'call_9', name: 'lookup' },
      },
      {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'input_json', partialJson: '{"q":"x"}' },
      },
      { type: 'content_block_stop', index: 2 },
      {
        type: 'message_delta',
        stopReason: 'tool_use',
        extensions: { $wire: { finish_reason: 'tool_calls' } },
      },
      { type: 'usage', usage: { inputTokens: 30, outputTokens: 12, cacheReadTokens: 5 } },
      { type: 'message_stop' },
    ]);
  });
});
