import { describe, expect, test } from 'vitest';
import { decodeAnthropicRequest } from '../anthropic-messages/decode-request.js';
import { expectSameJsonModuloStreamOptions, loadFixture } from '../test-utils.js';
import { decodeOpenAiRequest } from './decode-request.js';
import { encodeOpenAiRequest } from './encode-request.js';

describe('encodeOpenAiRequest', () => {
  test('round-trip identity on the full fixture (modulo stream_options injection)', () => {
    // Arrange
    const body = loadFixture('openai-request-full.json');
    // Act
    const encoded = encodeOpenAiRequest(decodeOpenAiRequest(body));
    // Assert
    expectSameJsonModuloStreamOptions(encoded, body);
    expect(JSON.parse(encoded).stream_options).toEqual({ include_usage: true });
  });

  test('round-trip identity on the shapes fixture', () => {
    // Arrange
    const body = loadFixture('openai-request-shapes.json');
    // Act
    const encoded = encodeOpenAiRequest(decodeOpenAiRequest(body));
    // Assert
    expectSameJsonModuloStreamOptions(encoded, body);
  });

  test('fails loud on topK (spec §10) and resolves maxTokens per model policy (spec §4.1 D17)', () => {
    // Arrange
    const ir = decodeOpenAiRequest(loadFixture('openai-request-shapes.json'));
    // Act + Assert
    expect(() =>
      encodeOpenAiRequest({ ...ir, params: { ...ir.params, topK: 40 } }),
    ).toThrowError(/top_k is not expressible/);
    // anthropic-origin max_tokens on a gpt-5 target resolves to max_completion_tokens
    const anthropicIr = decodeAnthropicRequest(
      loadFixture('anthropic-request-full.json'),
    );
    anthropicIr.model.physical = 'gpt-5';
    // First, remove the image from the user message (openai can't handle cross-format images)
    anthropicIr.messages = anthropicIr.messages.map(msg => {
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        return {
          ...msg,
          content: msg.content.filter(block => block.type !== 'image'),
        };
      }
      return msg;
    });
    // Remove topK from the copied IR
    const irForOpenai = {
      ...anthropicIr,
      params: { ...anthropicIr.params, topK: undefined },
    };
    expect(JSON.parse(encodeOpenAiRequest(irForOpenai)).max_completion_tokens).toBe(4096);
    // same field name survives on a non-o model
    irForOpenai.model.physical = 'gpt-4o';
    expect(JSON.parse(encodeOpenAiRequest(irForOpenai)).max_tokens).toBe(4096);
    expect(
      JSON.parse(encodeOpenAiRequest(irForOpenai)).max_completion_tokens,
    ).toBeUndefined();
    // explicit option wins over the heuristic
    expect(
      JSON.parse(
        encodeOpenAiRequest(irForOpenai, { maxTokensField: 'max_completion_tokens' }),
      ).max_completion_tokens,
    ).toBe(4096);
  });

  test('array-form single-text user content round-trips as an array (identity)', () => {
    // Arrange
    const ir = decodeOpenAiRequest(
      '{"model":"gpt-5","messages":[{"role":"user","content":[{"type":"text","text":"Hi"}]}]}',
    );
    // Act
    const encoded = JSON.parse(encodeOpenAiRequest(ir)) as Record<string, unknown>;
    const messages = encoded.messages as Record<string, unknown>[];
    // Assert
    expect(messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'Hi' }],
    });
  });

  test('text block with extension key survives encode', () => {
    // Arrange
    const ir = decodeOpenAiRequest(
      '{"model":"gpt-5","messages":[{"role":"user","content":[{"type":"text","text":"Hi","custom":1}]}]}',
    );
    // Act
    const encoded = JSON.parse(encodeOpenAiRequest(ir)) as Record<string, unknown>;
    const messages = encoded.messages as Record<string, unknown>[];
    const content = (messages[0]?.content as Record<string, unknown>[]) ?? [];
    // Assert
    expect(content[0]).toEqual({
      type: 'text',
      text: 'Hi',
      custom: 1,
    });
  });

  test('tool_result with image content throws FormatError', () => {
    // Arrange
    const ir = decodeOpenAiRequest(
      '{"model":"gpt-5","messages":[{"role":"user","content":"test"},{"role":"assistant","content":"test","tool_calls":[{"id":"test","type":"function","function":{"name":"test","arguments":"{}"}}]},{"role":"tool","tool_call_id":"test","content":"ok"}]}',
    );
    // Manually add image to tool_result content (not possible via openai decode)
    const toolResultMessage = ir.messages[2];
    if (
      toolResultMessage !== undefined &&
      toolResultMessage.content[0]?.type === 'tool_result'
    ) {
      toolResultMessage.content[0].content = [
        { type: 'text', text: 'ok' },
        { type: 'image', source: { kind: 'url', url: 'http://example.com/img.png' } },
      ];
    }
    // Act + Assert
    expect(() => encodeOpenAiRequest(ir)).toThrowError(
      /tool_result image content is not expressible/,
    );
  });
});
