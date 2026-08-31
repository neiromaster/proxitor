import { describe, expect, test } from 'vitest';
import { loadFixture } from '../test-utils.js';
import { decodeOpenAiRequest } from './decode-request.js';

describe('decodeOpenAiRequest', () => {
  test('decodes the full fixture: system, data-url image, tool merge, provenance, bag', () => {
    // Arrange
    const body = loadFixture('openai-request-full.json');
    // Act
    const ir = decodeOpenAiRequest(body);
    // Assert
    expect(ir.system).toEqual([
      { type: 'text', text: 'You are helpful.' },
      { type: 'text', text: 'Be safe.', extensions: { $wire: { role: 'developer' } } },
    ]);
    expect(ir.messages).toHaveLength(3);
    expect(ir.messages[0]?.content[1]).toEqual({
      type: 'image',
      source: { kind: 'base64', mediaType: 'image/png', data: 'aGk=' },
    });
    expect(ir.messages[1]).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Checking.' },
        { type: 'tool_use', id: 'call_1', name: 'lookup', input: { q: 'x' } },
      ],
      extensions: { $wire: { name: 'helper' } },
    });
    expect(ir.messages[2]?.content).toEqual([
      { type: 'tool_result', toolUseId: 'call_1', content: 'found' },
      { type: 'text', text: 'go on' },
    ]);
    expect(ir.params.maxTokens).toEqual({ value: 4096, source: 'max_completion_tokens' });
    expect(ir.params).toMatchObject({
      temperature: 0.7,
      topP: 0.9,
      stop: ['END'],
      presencePenalty: 0.1,
      frequencyPenalty: 0.2,
    });
    expect(ir.params.responseFormat).toEqual({
      kind: 'json_schema',
      schema: { type: 'object' },
    });
    expect(ir.extensions['openai-chat']).toMatchObject({
      logprobs: true,
      $wire: { jsonSchemaName: 'out', jsonSchemaStrict: true },
    });
    expect(ir.tools?.[0]).toMatchObject({
      name: 'lookup',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    });
    expect(ir.toolChoice).toEqual({ mode: 'auto' });
  });

  test('decodes shape variants: stop string, object tool_choice, content null, system parts', () => {
    // Arrange
    const body = loadFixture('openai-request-shapes.json');
    // Act
    const ir = decodeOpenAiRequest(body);
    // Assert
    expect(ir.params.stop).toEqual(['END']);
    expect(ir.extensions['openai-chat']?.$wire).toEqual({
      stopString: true,
      toolChoiceObject: true,
    });
    expect(ir.system[0]?.extensions).toEqual({ $wire: { systemContentParts: true } });
    expect(ir.messages[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'call_2', name: 'img', input: {} }],
      extensions: { $wire: { contentNull: true } },
    });
    expect(ir.params.maxTokens).toEqual({ value: 100, source: 'max_tokens' });
  });

  test('trailing tool messages become a synthetic user turn (spec §4.1)', () => {
    // Arrange
    const body = JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'c1', type: 'function', function: { name: 't', arguments: '{}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'c1', content: 'r1' },
      ],
    });
    // Act
    const ir = decodeOpenAiRequest(body);
    // Assert
    expect(ir.messages).toHaveLength(3);
    expect(ir.messages[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', toolUseId: 'c1', content: 'r1' }],
    });
  });

  test('an assistant message between tool results triggers the synthetic user turn at that position', () => {
    // Arrange
    const body = JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'c1', type: 'function', function: { name: 't', arguments: '{}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'c1', content: 'r1' },
        { role: 'assistant', content: 'done' },
      ],
    });
    // Act
    const ir = decodeOpenAiRequest(body);
    // Assert
    expect(ir.messages.map(m => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(ir.messages[2]?.content[0]).toMatchObject({
      type: 'tool_result',
      toolUseId: 'c1',
    });
  });
});
