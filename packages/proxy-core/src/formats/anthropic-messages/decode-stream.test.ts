import { describe, expect, test } from 'vitest';
import { loadFixture } from '../test-utils.js';
import { createAnthropicStreamDecoder } from './decode-stream.js';

describe('createAnthropicStreamDecoder', () => {
  test('decodes the full fixture in one push, folding envelope usage into a usage event', () => {
    // Arrange
    const wire = loadFixture('anthropic-stream-full.sse.txt');
    const decoder = createAnthropicStreamDecoder();
    // Act
    const events = [...decoder.push(wire), ...decoder.end()];
    // Assert
    expect(events).toEqual([
      { type: 'message_start', id: 'msg_01ABC', model: 'claude-sonnet-4-5' },
      { type: 'usage', usage: { inputTokens: 25, outputTokens: 1 } },
      { type: 'content_block_start', index: 0, block: { type: 'text', text: '' } },
      { type: 'ping' },
      { type: 'content_block_delta', index: 0, delta: { type: 'text', text: 'Hello' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text', text: '!' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        block: { type: 'tool_use', id: 'toolu_01A', name: 'lookup' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json', partialJson: '{"q":' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json', partialJson: '"x"}' },
      },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', stopReason: 'tool_use', usage: { outputTokens: 57 } },
      { type: 'message_stop' },
    ]);
  });

  test('decodes identically when chunks split mid-event (incremental tokenizer)', () => {
    // Arrange
    const wire = loadFixture('anthropic-stream-full.sse.txt');
    const decoder = createAnthropicStreamDecoder();
    const events: unknown[] = [];
    // Act
    for (let i = 0; i < wire.length; i += 37) {
      events.push(...decoder.push(wire.slice(i, i + 37)));
    }
    events.push(...decoder.end());
    // Assert
    const whole = [
      ...createAnthropicStreamDecoder().push(wire),
      ...createAnthropicStreamDecoder().end(),
    ];
    expect(events).toEqual(whole);
  });

  test('a started stream without message_stop ends with a stream_truncated error', () => {
    // Arrange
    const wire = loadFixture('anthropic-stream-full.sse.txt').replace(
      'event: message_stop\ndata: {"type":"message_stop"}\n',
      '',
    );
    const decoder = createAnthropicStreamDecoder();
    // Act
    const events = [...decoder.push(wire), ...decoder.end()];
    // Assert
    expect(events.at(-1)).toEqual({
      type: 'error',
      error: {
        type: 'stream_truncated',
        message: 'stream ended without message_stop',
        status: 502,
      },
    });
  });

  test('a 0/0 envelope emits no usage event and an exotic stop_reason keeps its raw form in $wire', () => {
    // Arrange
    const decoder = createAnthropicStreamDecoder();
    // Act
    const events = [
      ...decoder.push(
        'data: {"type":"message_start","message":{"id":"m","model":"c","usage":{"input_tokens":0,"output_tokens":0}}}\n\n' +
          'data: {"type":"message_delta","delta":{"stop_reason":"pause_turn","stop_sequence":null},"usage":{"output_tokens":9}}\n\n' +
          'data: {"type":"message_stop"}\n\n',
      ),
      ...decoder.end(),
    ];
    // Assert
    expect(events[0]?.type).toBe('message_start');
    expect(events[1]).toEqual({
      type: 'message_delta',
      stopReason: 'end_turn',
      usage: { outputTokens: 9 },
      extensions: { $wire: { stopReason: 'pause_turn' } },
    });
  });
});
