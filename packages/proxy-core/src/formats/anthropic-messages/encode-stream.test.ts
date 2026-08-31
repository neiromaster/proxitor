import { describe, expect, test } from 'vitest';
import { loadFixture } from '../test-utils.js';
import { createAnthropicStreamDecoder } from './decode-stream.js';
import { createAnthropicStreamEncoder } from './encode-stream.js';

function roundTrip(wire: string) {
  const decoder = createAnthropicStreamDecoder();
  const ir = [...decoder.push(wire), ...decoder.end()];
  const model = ir.find(e => e.type === 'message_start')?.model ?? 'test-model';
  const encoder = createAnthropicStreamEncoder({
    model,
    random: { uuid: () => 'test-uuid' },
  });
  const encoded = ir.map(event => encoder.push(event)).join('') + encoder.end();
  const redecoder = createAnthropicStreamDecoder();
  const back = [...redecoder.push(encoded), ...redecoder.end()];
  return { ir, back };
}

describe('createAnthropicStreamEncoder', () => {
  test('encode(decode(wire)) re-decodes to the identical IR sequence (converged round trip)', () => {
    // Arrange
    const wire = loadFixture('anthropic-stream-full.sse.txt');
    // Act
    const { ir, back } = roundTrip(wire);
    // Assert
    expect(back).toEqual(ir);
  });

  test('restores an exotic stop_reason from $wire provenance', () => {
    // Arrange
    const encoder = createAnthropicStreamEncoder({
      model: 'test-model',
      random: { uuid: () => 'test-uuid' },
    });
    // Act
    const encoded =
      encoder.push({
        type: 'message_delta',
        stopReason: 'end_turn' as const,
        extensions: { $wire: { stopReason: 'pause_turn' } },
      }) + encoder.end();
    // Assert
    expect(encoded).toContain('"stop_reason":"pause_turn"');
  });

  test('normalizes a broken sequence: bare delta gets start/stop (last line of defense)', () => {
    // Arrange
    const encoder = createAnthropicStreamEncoder({
      model: 'test-model',
      random: { uuid: () => 'test-uuid' },
    });
    // Act
    const encoded =
      encoder.push({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text', text: 'hi' },
      }) + encoder.end();
    // Assert
    expect(encoded).toContain('"type":"message_start"');
    expect(encoded).toContain('"type":"message_stop"');
  });

  test('encodes a standalone usage event as a usage-only message_delta', () => {
    // Arrange
    const encoder = createAnthropicStreamEncoder({
      model: 'test-model',
      random: { uuid: () => 'test-uuid' },
    });
    // Act
    const encoded =
      encoder.push({ type: 'usage', usage: { inputTokens: 0, outputTokens: 9 } }) +
      encoder.end();
    // Assert
    expect(encoded).toContain('"usage":{"output_tokens":9}');
    expect(encoded).not.toContain('stop_reason');
  });
});
