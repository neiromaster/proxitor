import type { ClockPort, RandomPort } from '@proxitor/plugin-api';
import { describe, expect, test } from 'vitest';
import { decodeAnthropicRequest } from './anthropic-messages/decode-request.js';
import { createAnthropicStreamDecoder } from './anthropic-messages/decode-stream.js';
import { getFormat } from './index.js';
import { createOpenAiStreamEncoder } from './openai-chat/encode-stream.js';
import { expectSameJson, loadFixture } from './test-utils.js';

const clock: ClockPort = { now: () => 1755596800000 };
const random: RandomPort = { uuid: () => 'fixed-uuid' };

describe('cross-format goldens', () => {
  test('registry exposes both adapters', () => {
    // Act + Assert
    expect(getFormat('anthropic-messages').format).toBe('anthropic-messages');
    expect(getFormat('openai-chat').format).toBe('openai-chat');
  });

  test('Claude Code request translates to the golden openai body', () => {
    // Arrange
    const ir = decodeAnthropicRequest(
      loadFixture('cross-format/cc-claude-to-openai.request.json'),
    );
    ir.model.physical = 'claude-sonnet-4-5';
    // Act
    const encoded = getFormat('openai-chat').encodeRequest(ir);
    // Assert
    expectSameJson(
      encoded,
      loadFixture('cross-format/cc-claude-to-openai.expected-openai.json'),
    );
  });

  test('anthropic tool stream re-encodes to the golden openai stream byte-for-byte', () => {
    // Arrange
    const wire = loadFixture('cross-format/tools-stream.anthropic.sse.txt');
    const decoder = createAnthropicStreamDecoder();
    const ir = [...decoder.push(wire), ...decoder.end()];
    const encoder = createOpenAiStreamEncoder({
      model: 'claude-sonnet-4-5',
      clock,
      random,
    });
    // Act
    const encoded = ir.map(event => encoder.push(event)).join('') + encoder.end();
    // Assert
    expect(encoded).toBe(
      loadFixture('cross-format/tools-stream.expected-openai.sse.txt'),
    );
  });
});
