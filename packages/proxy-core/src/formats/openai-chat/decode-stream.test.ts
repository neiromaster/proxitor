import { describe, expect, test } from 'vitest';
import { loadFixture } from '../test-utils.js';
import { createOpenAiStreamDecoder } from './decode-stream.js';

describe('createOpenAiStreamDecoder', () => {
  test('decodes the full fixture into canonical events with synthesized block lifecycle', () => {
    // Arrange
    const wire = loadFixture('openai-stream-full.sse.txt');
    const decoder = createOpenAiStreamDecoder();
    // Act
    const events = [...decoder.push(wire), ...decoder.end()];
    // Assert
    expect(events).toEqual([
      { type: 'message_start', id: 'chatcmpl-1', model: 'gpt-5' },
      { type: 'content_block_start', index: 0, block: { type: 'thinking' } },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking', thinking: 'ponder' },
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text', text: 'Hello' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text', text: '!' } },
      { type: 'content_block_stop', index: 1 },
      {
        type: 'content_block_start',
        index: 2,
        block: { type: 'tool_use', id: 'call_1', name: 'lookup' },
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
      { type: 'usage', usage: { inputTokens: 25, outputTokens: 57 } },
      { type: 'message_stop' },
    ]);
  });

  test('decodes identically when split at arbitrary chunk boundaries', () => {
    // Arrange
    const wire = loadFixture('openai-stream-full.sse.txt');
    const piecewise = createOpenAiStreamDecoder();
    const events: unknown[] = [];
    // Act
    for (let i = 0; i < wire.length; i += 23) {
      events.push(...piecewise.push(wire.slice(i, i + 23)));
    }
    events.push(...piecewise.end());
    // Assert
    const whole = [
      ...createOpenAiStreamDecoder().push(wire),
      ...createOpenAiStreamDecoder().end(),
    ];
    expect(events).toEqual(whole);
  });

  test('maps content_filter to end_turn keeping the raw finish_reason', () => {
    // Arrange
    const decoder = createOpenAiStreamDecoder();
    // Act
    const events = [
      ...decoder.push(
        'data: {"id":"c","model":"gpt-5","choices":[{"index":0,"delta":{"content":"x"}}]}\n\n',
      ),
      ...decoder.push(
        'data: {"id":"c","model":"gpt-5","choices":[{"index":0,"delta":{},"finish_reason":"content_filter"}]}\n\n',
      ),
      ...decoder.push('data: [DONE]\n\n'),
      ...decoder.end(),
    ];
    // Assert
    expect(events).toContainEqual({
      type: 'message_delta',
      stopReason: 'end_turn',
      extensions: { $wire: { finish_reason: 'content_filter' } },
    });
  });

  test('a started stream without [DONE] ends with a stream_truncated error', () => {
    // Arrange
    const decoder = createOpenAiStreamDecoder();
    // Act
    const events = [
      ...decoder.push(
        'data: {"id":"c","model":"gpt-5","choices":[{"index":0,"delta":{"content":"x"}}]}\n\n',
      ),
      ...decoder.end(),
    ];
    // Assert
    expect(events.at(-1)).toEqual({
      type: 'error',
      error: {
        type: 'stream_truncated',
        message: 'stream ended without [DONE]',
        status: 502,
      },
    });
  });
});
