import type { ClockPort, RandomPort } from '@proxitor/plugin-api';
import { describe, expect, test } from 'vitest';
import { decodeAnthropicRequest } from './anthropic-messages/decode-request.js';
import { createAnthropicStreamDecoder } from './anthropic-messages/decode-stream.js';
import { createAnthropicStreamEncoder } from './anthropic-messages/encode-stream.js';
import { getFormat } from './index.js';
import { decodeOpenAiRequest } from './openai-chat/decode-request.js';
import { createOpenAiStreamDecoder } from './openai-chat/decode-stream.js';
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

  test('openai request with max_completion_tokens translates to golden anthropic body', () => {
    // Arrange
    const ir = decodeOpenAiRequest(loadFixture('openai-request-full.json'));
    ir.model.physical = 'claude-sonnet-4-5';
    ir.params.responseFormat = undefined; // not expressible in anthropic
    ir.params.presencePenalty = undefined; // not expressible in anthropic
    ir.params.frequencyPenalty = undefined; // not expressible in anthropic
    // Act
    const encoded = getFormat('anthropic-messages').encodeRequest(ir);
    // Assert
    expectSameJson(
      encoded,
      loadFixture('cross-format/openai-to-anthropic.expected-anthropic.json'),
    );
  });

  test('openai request without max_tokens throws FormatError', () => {
    // Arrange
    const body = loadFixture('openai-request-full.json');
    const parsed = JSON.parse(body) as Record<string, unknown>;
    delete parsed.max_completion_tokens;
    delete parsed.max_tokens;
    const ir = decodeOpenAiRequest(JSON.stringify(parsed));
    ir.model.physical = 'claude-sonnet-4-5';
    // Act + Assert
    expect(() => getFormat('anthropic-messages').encodeRequest(ir)).toThrowError(
      /max_tokens is required/,
    );
  });

  test('openai tool stream re-encodes to anthropic and round-trips', () => {
    // Arrange
    const wire = loadFixture('openai-stream-full.sse.txt');
    const openaiDecoder = createOpenAiStreamDecoder();
    const ir = [...openaiDecoder.push(wire), ...openaiDecoder.end()];
    const anthropicEncoder = createAnthropicStreamEncoder({
      model: 'claude-sonnet-4-5',
      random,
    });
    // Act
    const anthropicSse =
      ir.map(event => anthropicEncoder.push(event)).join('') + anthropicEncoder.end();
    const anthropicDecoder = createAnthropicStreamDecoder();
    const roundTripped = [
      ...anthropicDecoder.push(anthropicSse),
      ...anthropicDecoder.end(),
    ];
    // Assert: verify key events are preserved (message_start, tool_use, message_stop, usage)
    expect(roundTripped.some(e => e.type === 'message_start')).toBe(true);
    expect(
      roundTripped.some(
        e => e.type === 'content_block_start' && e.block.type === 'tool_use',
      ),
    ).toBe(true);
    expect(roundTripped.some(e => e.type === 'message_stop')).toBe(true);
    expect(roundTripped.some(e => e.type === 'usage')).toBe(true);
    // anthropic synthesizes signature_delta for thinking blocks
    expect(roundTripped.some(e => e.type === 'signature_delta')).toBe(true);
  });
});
