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
      loadFixture('anthropic-request-shapes.json'),
    );
    anthropicIr.model.physical = 'gpt-5';
    expect(JSON.parse(encodeOpenAiRequest(anthropicIr)).max_completion_tokens).toBe(100);
    // same field name survives on a non-o model
    anthropicIr.model.physical = 'gpt-4o';
    expect(JSON.parse(encodeOpenAiRequest(anthropicIr)).max_tokens).toBe(100);
    expect(
      JSON.parse(encodeOpenAiRequest(anthropicIr)).max_completion_tokens,
    ).toBeUndefined();
    // explicit option wins over the heuristic
    anthropicIr.model.physical = 'gpt-4o';
    expect(
      JSON.parse(
        encodeOpenAiRequest(anthropicIr, { maxTokensField: 'max_completion_tokens' }),
      ).max_completion_tokens,
    ).toBe(100);
  });

  test('maps $proxitor reserved keys after the passthrough merge (plugin overrides client hints)', () => {
    // Arrange
    const ir = decodeOpenAiRequest(loadFixture('openai-request-shapes.json'));
    ir.extensions['openai-chat'] = {
      ...ir.extensions['openai-chat'],
      provider: 'openrouter',
      '$proxitor.provider': 'deepseek',
    };
    // Act
    const encoded = JSON.parse(encodeOpenAiRequest(ir)) as Record<string, unknown>;
    // Assert
    expect(encoded.provider).toBe('deepseek');
    expect(encoded['$proxitor.provider']).toBeUndefined();
  });

  test('cross-format: anthropic fixture encodes to a valid openai request', () => {
    // Arrange
    const withTopK = decodeAnthropicRequest(loadFixture('anthropic-request-full.json'));
    withTopK.model.physical = 'gpt-5';
    const ir = { ...withTopK, params: { ...withTopK.params, topK: undefined } };
    ir.stream = false;
    // Act + Assert: topK fails loud first (spec §10)…
    expect(() => encodeOpenAiRequest(withTopK)).toThrowError(/top_k is not expressible/);
    // …then the stripped IR encodes cleanly
    const encoded = JSON.parse(encodeOpenAiRequest(ir)) as Record<string, unknown>;
    const messages = encoded.messages as Record<string, unknown>[];
    // Assert
    expect(encoded.model).toBe('gpt-5');
    expect(encoded.max_completion_tokens).toBe(4096);
    expect(encoded.stop).toEqual(['END']);
    expect(encoded.temperature).toBe(0.7);
    expect(encoded.top_p).toBe(0.9);
    expect(encoded.top_k).toBeUndefined();
    expect(messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(messages[1]).toEqual({ role: 'system', content: 'Extra.' });
    expect(messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'What is this?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,aGk=' } },
      ],
    });
    expect(messages[3]?.tool_calls).toBeDefined();
    const toolCalls = messages[3]?.tool_calls as Record<string, unknown>[] | undefined;
    expect(toolCalls?.[0]).toEqual({
      id: 'toolu_1',
      type: 'function',
      function: { name: 'lookup', arguments: '{"q":"x"}' },
    });
    expect(messages[4]).toEqual({
      role: 'tool',
      tool_call_id: 'toolu_1',
      content: 'found',
    });
    expect(messages[5]).toEqual({ role: 'user', content: 'go on' });
    expect(encoded.thinking).toBeUndefined();
    expect(encoded.metadata).toBeUndefined();
  });
});
