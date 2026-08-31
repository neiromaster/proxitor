import type { ClockPort, RandomPort } from '@proxitor/plugin-api';
import { describe, expect, test } from 'vitest';
import { loadFixture } from '../test-utils.js';
import { createOpenAiStreamDecoder } from './decode-stream.js';
import { createOpenAiStreamEncoder } from './encode-stream.js';

const clock: ClockPort = { now: () => 1755596800000 };
const random: RandomPort = { uuid: () => 'fixed-uuid' };

describe('createOpenAiStreamEncoder', () => {
  test('encode(decode(wire)) re-decodes to the identical IR sequence', () => {
    // Arrange
    const wire = loadFixture('openai-stream-full.sse.txt');
    const decoder = createOpenAiStreamDecoder();
    const ir = [...decoder.push(wire), ...decoder.end()];
    const encoder = createOpenAiStreamEncoder({ model: 'gpt-5', clock, random });
    // Act
    const encoded = ir.map(event => encoder.push(event)).join('') + encoder.end();
    const redecoder = createOpenAiStreamDecoder();
    const back = [...redecoder.push(encoded), ...redecoder.end()];
    // Assert
    expect(back).toEqual(ir);
  });

  test('normalizes a bare delta into role chunk + content + [DONE] (last line of defense)', () => {
    // Arrange
    const encoder = createOpenAiStreamEncoder({ model: 'gpt-5', clock, random });
    // Act
    const encoded =
      encoder.push({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text', text: 'hi' },
      }) + encoder.end();
    // Assert
    expect(encoded).toContain('"role":"assistant"');
    expect(encoded).toContain('"content":"hi"');
    expect(encoded.trimEnd().endsWith('data: [DONE]')).toBe(true);
  });

  test('emits ping as an SSE comment and error without [DONE]', () => {
    // Arrange
    const encoderP = createOpenAiStreamEncoder({ model: 'gpt-5', clock, random });
    const encoderE = createOpenAiStreamEncoder({ model: 'gpt-5', clock, random });
    // Act
    const ping = encoderP.push({ type: 'ping' });
    const error =
      encoderE.push({
        type: 'error',
        error: { type: 'api_error', message: 'boom', status: 500 },
      }) + encoderE.end();
    // Assert
    expect(ping).toBe(': ping\n\n');
    expect(error).toContain('"error"');
    expect(error).not.toContain('[DONE]');
  });

  test('folds deferred usage before [DONE], honoring the final message_delta output override', () => {
    // Arrange
    const encoder = createOpenAiStreamEncoder({ model: 'gpt-5', clock, random });
    const events = [
      { type: 'message_start', id: 'chatcmpl-1', model: 'gpt-5' },
      { type: 'usage', usage: { inputTokens: 25, outputTokens: 1 } },
      {
        type: 'message_delta',
        stopReason: 'end_turn' as const,
        usage: { outputTokens: 57 },
      },
      { type: 'message_stop' },
    ] as const;
    // Act
    const encoded = events.map(event => encoder.push(event)).join('') + encoder.end();
    // Assert
    const usageLine = encoded.split('\n').find(line => line.includes('"usage"'));
    expect(usageLine).toContain('"prompt_tokens":25');
    expect(usageLine).toContain('"completion_tokens":57');
    expect(usageLine).toContain('"total_tokens":82');
    expect(encoded.indexOf('"usage"')).toBeLessThan(encoded.indexOf('[DONE]'));
  });

  test('error is terminal: no [DONE] after error event', () => {
    // Arrange
    const encoder = createOpenAiStreamEncoder({ model: 'gpt-5', clock, random });
    const events = [
      { type: 'message_start', id: 'chatcmpl-1', model: 'gpt-5' },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text', text: 'Hello' },
      },
      {
        type: 'error',
        error: { type: 'api_error', message: 'boom', status: 500 },
      },
    ] as const;
    // Act
    const encoded = events.map(event => encoder.push(event)).join('') + encoder.end();
    // Assert
    expect(encoded).toContain('"error"');
    expect(encoded).toContain('"boom"');
    expect(encoded).not.toContain('[DONE]');
  });

  test('error suppresses subsequent content: no synthesized start/chunks after error', () => {
    // Arrange
    const encoder = createOpenAiStreamEncoder({ model: 'gpt-5', clock, random });
    const events = [
      {
        type: 'error',
        error: { type: 'api_error', message: 'early error', status: 500 },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text', text: 'should not appear' },
      },
    ] as const;
    // Act
    const encoded = events.map(event => encoder.push(event)).join('') + encoder.end();
    // Assert
    expect(encoded).toContain('"error"');
    expect(encoded).toContain('"early error"');
    expect(encoded).not.toContain('"role":"assistant"'); // no message_start synthesized
    expect(encoded).not.toContain('should not appear'); // no content chunks emitted
    expect(encoded).not.toContain('[DONE]');
  });

  test('preserves cache tokens through message_delta output override', () => {
    // Arrange
    const encoder = createOpenAiStreamEncoder({ model: 'gpt-5', clock, random });
    const events = [
      { type: 'message_start', id: 'chatcmpl-1', model: 'gpt-5' },
      {
        type: 'usage',
        usage: { inputTokens: 100, outputTokens: 1, cacheReadTokens: 50 },
      },
      {
        type: 'message_delta',
        stopReason: 'end_turn' as const,
        usage: { outputTokens: 57 },
      },
      { type: 'message_stop' },
    ] as const;
    // Act
    const encoded = events.map(event => encoder.push(event)).join('') + encoder.end();
    // Assert
    const usageLine = encoded.split('\n').find(line => line.includes('"usage"'));
    expect(usageLine).toContain('"prompt_tokens":100');
    expect(usageLine).toContain('"completion_tokens":57');
    expect(usageLine).toContain('"total_tokens":157');
    expect(usageLine).toContain('"cached_tokens":50');
    expect(encoded.indexOf('"usage"')).toBeLessThan(encoded.indexOf('[DONE]'));
  });
});
