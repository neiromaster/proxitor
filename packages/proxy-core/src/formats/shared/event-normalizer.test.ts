import type { CanonicalEvent, RandomPort } from '@proxitor/plugin-api';
import { describe, expect, test } from 'vitest';
import { createEventSequenceNormalizer } from './event-normalizer.js';

const random: RandomPort = { uuid: () => 'fixed-uuid' };

function start(): CanonicalEvent {
  return { type: 'message_start', id: 'msg_fixed-uuid', model: 'claude-x' };
}

describe('createEventSequenceNormalizer', () => {
  test('synthesizes message_start and message_stop around a bare delta sequence', () => {
    // Arrange
    const n = createEventSequenceNormalizer({ model: 'claude-x', random });
    // Act
    const out = n.push([
      { type: 'content_block_start', index: 0, block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text', text: 'hi' } },
    ]);
    const tail = n.end();
    // Assert
    expect(out[0]).toEqual(start());
    expect(out).toHaveLength(3);
    expect(tail).toEqual([
      { type: 'content_block_stop', index: 0 },
      { type: 'message_stop' },
    ]);
  });

  test('opens a block for an orphan input_json delta with a synthesized id and name', () => {
    // Arrange
    const n = createEventSequenceNormalizer({ model: 'claude-x', random });
    // Act
    const out = n.push([
      {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'input_json', partialJson: '{"q"' },
      },
      { type: 'content_block_stop', index: 2 },
    ]);
    const tail = n.end();
    // Assert
    expect(out).toEqual([
      start(),
      {
        type: 'content_block_start',
        index: 2,
        block: { type: 'tool_use', id: 'toolu_fixed-uuid', name: 'unknown_tool' },
      },
      {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'input_json', partialJson: '{"q"' },
      },
      { type: 'content_block_stop', index: 2 },
    ]);
    expect(tail).toEqual([{ type: 'message_stop' }]);
  });

  test('synthesizes an empty signature_delta for thinking blocks that never got one', () => {
    // Arrange
    const n = createEventSequenceNormalizer({ model: 'claude-x', random });
    // Act
    const out = n.push([
      { type: 'message_start', id: 'msg_1', model: 'claude-x' },
      { type: 'content_block_start', index: 0, block: { type: 'thinking' } },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking', thinking: 'hm' },
      },
      { type: 'content_block_stop', index: 0 },
    ]);
    const tail = n.end();
    // Assert
    expect(out[3]).toEqual({ type: 'signature_delta', index: 0, signature: '' });
    expect(out[4]).toEqual({ type: 'content_block_stop', index: 0 });
    expect(tail).toEqual([{ type: 'message_stop' }]);
  });

  test('drops everything after a terminal error and end() emits nothing', () => {
    // Arrange
    const n = createEventSequenceNormalizer({ model: 'claude-x', random });
    // Act
    const out = n.push([
      { type: 'message_start', id: 'msg_1', model: 'claude-x' },
      { type: 'error', error: { type: 'api_error', message: 'boom', status: 500 } },
      { type: 'content_block_start', index: 0, block: { type: 'text' } },
    ]);
    const tail = n.end();
    // Assert
    expect(out).toHaveLength(2);
    expect(tail).toEqual([]);
  });

  test('drops duplicate message_start and keeps ping/usage passthrough', () => {
    // Arrange
    const n = createEventSequenceNormalizer({ model: 'claude-x', random });
    // Act
    const out = n.push([
      { type: 'message_start', id: 'msg_1', model: 'claude-x' },
      { type: 'ping' },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
      { type: 'message_start', id: 'msg_2', model: 'other' },
    ]);
    // Assert
    expect(out).toEqual([
      { type: 'message_start', id: 'msg_1', model: 'claude-x' },
      { type: 'ping' },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    ]);
  });
});
