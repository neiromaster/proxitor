import { describe, expect, test } from 'vitest';
import { loadFixture } from '../test-utils.js';
import { decodeAnthropicRequest } from './decode-request.js';

describe('decodeAnthropicRequest', () => {
  test('decodes the full fixture: params, provenance, tools, passthrough bag', () => {
    // Arrange
    const body = loadFixture('anthropic-request-full.json');
    // Act
    const ir = decodeAnthropicRequest(body);
    // Assert
    expect(ir.model).toEqual({ logical: 'claude-sonnet-5', physical: 'claude-sonnet-5' });
    expect(ir.params.maxTokens).toEqual({ value: 4096, source: 'max_tokens' });
    expect(ir.params).toMatchObject({
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      stop: ['END'],
    });
    expect(ir.stream).toBe(true);
    expect(ir.system[0]).toMatchObject({
      text: 'You are helpful.',
      cacheControl: { type: 'ephemeral' },
    });
    expect(ir.messages[1]?.content).toHaveLength(3);
    expect(ir.messages[1]?.content[0]).toMatchObject({
      type: 'thinking',
      thinking: 'hmm',
      signature: 'sig1',
    });
    expect(ir.messages[1]?.content[2]).toEqual({
      type: 'tool_use',
      id: 'toolu_1',
      name: 'lookup',
      input: { q: 'x' },
    });
    expect(ir.messages[2]?.content[0]).toMatchObject({
      type: 'tool_result',
      toolUseId: 'toolu_1',
      content: 'found',
    });
    expect(ir.tools?.[0]).toMatchObject({
      name: 'lookup',
      cacheControl: { type: 'ephemeral', ttl: '1h' },
    });
    expect(ir.toolChoice).toEqual({ mode: 'tool', name: 'lookup' });
    expect(ir.extensions['anthropic-messages']).toMatchObject({
      thinking: { type: 'enabled', budget_tokens: 1024 },
      metadata: { user_id: 'u1' },
      custom_flag: 1,
    });
  });

  test('decodes string shapes into blocks and records $wire flags', () => {
    // Arrange
    const body = loadFixture('anthropic-request-shapes.json');
    // Act
    const ir = decodeAnthropicRequest(body);
    // Assert
    expect(ir.system).toEqual([{ type: 'text', text: 'Be terse.' }]);
    expect(ir.extensions['anthropic-messages']?.$wire).toEqual({
      systemString: true,
      streamFalse: true,
    });
    expect(ir.messages[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Hi' }],
    });
    expect(ir.messages[0]?.extensions).toEqual({ $wire: { contentString: true } });
    expect(ir.extensions['anthropic-messages']?.$wire).toEqual({
      systemString: true,
      streamFalse: true,
    });
    expect(ir.messages[2]?.content?.[0]).toMatchObject({
      type: 'tool_result',
      toolUseId: 'toolu_2',
    });
    const toolResultContent = ir.messages[2]?.content?.[0];
    if (
      toolResultContent?.type === 'tool_result' &&
      typeof toolResultContent.content !== 'string'
    ) {
      expect(toolResultContent.content).toEqual([
        { type: 'text', text: 'a pic' },
        { type: 'image', source: { kind: 'url', url: 'https://example.com/i.png' } },
      ]);
    }
    expect(ir.stream).toBe(false);
  });

  test('rejects unconvertible content blocks with a 400 FormatError', () => {
    // Arrange
    const body = JSON.stringify({
      model: 'm',
      max_tokens: 10,
      messages: [{ role: 'user', content: [{ type: 'document', source: {} }] }],
    });
    // Act + Assert
    expect(() => decodeAnthropicRequest(body)).toThrowError(
      /unconvertible content block type 'document'/,
    );
  });

  test('rejects a missing max_tokens with a 400 FormatError', () => {
    // Arrange
    const body = JSON.stringify({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
    });
    // Act + Assert
    expect(() => decodeAnthropicRequest(body)).toThrowError(/max_tokens is required/);
  });
});
