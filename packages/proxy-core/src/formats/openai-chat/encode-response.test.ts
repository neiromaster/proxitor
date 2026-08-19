import type { ClockPort, RandomPort } from '@proxitor/plugin-api';
import { describe, expect, test } from 'vitest';
import { expectSameJson } from '../test-utils.js';
import { decodeOpenAiResponse } from './decode-response.js';
import { encodeOpenAiResponse } from './encode-response.js';

const clock: ClockPort = { now: () => 1755596800000 };
const random: RandomPort = { uuid: () => 'fixed-uuid' };

describe('encodeOpenAiResponse', () => {
  test('round-trips a completion body modulo JSON canonicalization', () => {
    // Arrange
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
    // Act
    const encoded = encodeOpenAiResponse(decodeOpenAiResponse(body), {
      model: 'gpt-5',
      clock,
      random,
    });
    // Assert
    expectSameJson(encoded, body);
  });

  test('drops signature and synthesizes message fields from a partial IR sequence', () => {
    // Arrange
    const events = [
      { type: 'message_start', id: 'chatcmpl-7', model: 'gpt-5' },
      { type: 'content_block_start', index: 0, block: { type: 'thinking' } },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking', thinking: 'hm' },
      },
      { type: 'signature_delta', index: 0, signature: 'sig' },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_stop' },
    ] as const;
    // Act
    const encoded = JSON.parse(
      encodeOpenAiResponse(events, { model: 'gpt-5', clock, random }),
    ) as Record<string, unknown>;
    const choice = (encoded.choices as Record<string, unknown>[])[0];
    const message = choice?.message as Record<string, unknown>;
    // Assert
    expect(message.reasoning_content).toBe('hm');
    expect(message.signature).toBeUndefined();
    expect(choice?.finish_reason).toBe('stop');
    expect(encoded.usage).toEqual({});
  });
});
