import type { CanonicalRequest } from '@proxitor/plugin-api';
import { describe, expect, test } from 'vitest';
import { expectSameJson, loadFixture } from '../test-utils.js';
import { decodeAnthropicRequest } from './decode-request.js';
import { encodeAnthropicRequest } from './encode-request.js';

describe('encodeAnthropicRequest', () => {
  test('round-trip identity on the full fixture (spec §4.4)', () => {
    // Arrange
    const body = loadFixture('anthropic-request-full.json');
    // Act
    const encoded = encodeAnthropicRequest(decodeAnthropicRequest(body));
    // Assert
    expectSameJson(encoded, body);
  });

  test('round-trip identity on the string-shapes fixture (maxTokens keeps its field name)', () => {
    // Arrange
    const body = loadFixture('anthropic-request-shapes.json');
    // Act
    const encoded = encodeAnthropicRequest(decodeAnthropicRequest(body));
    // Assert
    expectSameJson(encoded, body);
  });

  test('fails loud on params anthropic cannot express (spec §10)', () => {
    // Arrange
    const ir = decodeAnthropicRequest(loadFixture('anthropic-request-shapes.json'));
    const broken: CanonicalRequest = { ...ir, params: { ...ir.params, seed: 42 } };
    // Act + Assert
    expect(() => encodeAnthropicRequest(broken)).toThrowError(/seed is not expressible/);
  });

  test('unsupportedParams drop silently omits inexpressible optional params (spec §10)', () => {
    // Arrange — seed, responseFormat, and both penalties are inexpressible in anthropic
    const ir = decodeAnthropicRequest(loadFixture('anthropic-request-shapes.json'));
    const broken: CanonicalRequest = {
      ...ir,
      params: {
        ...ir.params,
        seed: 42,
        responseFormat: { kind: 'json' },
        presencePenalty: 0.5,
        frequencyPenalty: -0.5,
      },
    };
    // Act
    const encoded = JSON.parse(
      encodeAnthropicRequest(broken, { unsupportedParams: 'drop' }),
    ) as Record<string, unknown>;
    // Assert — encoding succeeds and none of the dropped params reach the wire
    expect(encoded.seed).toBeUndefined();
    expect(encoded.response_format).toBeUndefined();
    expect(encoded.presence_penalty).toBeUndefined();
    expect(encoded.frequency_penalty).toBeUndefined();
  });

  test('missing max_tokens throws even with unsupportedParams drop (required param)', () => {
    // Arrange
    const ir = decodeAnthropicRequest(loadFixture('anthropic-request-shapes.json'));
    const noMaxTokens: CanonicalRequest = {
      ...ir,
      params: { ...ir.params, maxTokens: undefined },
    };
    // Act + Assert
    expect(() =>
      encodeAnthropicRequest(noMaxTokens, { unsupportedParams: 'drop' }),
    ).toThrowError(/max_tokens is required/);
  });

  test('unsupportedParams error (and the default) fail loud for each inexpressible param class (spec §10)', () => {
    // Arrange — one IR per inexpressible optional param class
    const ir = decodeAnthropicRequest(loadFixture('anthropic-request-shapes.json'));
    const cases: CanonicalRequest[] = [
      { ...ir, params: { ...ir.params, seed: 42 } },
      { ...ir, params: { ...ir.params, responseFormat: { kind: 'json' } } },
      { ...ir, params: { ...ir.params, presencePenalty: 0.5 } },
      { ...ir, params: { ...ir.params, frequencyPenalty: -0.5 } },
    ];
    // Act + Assert — explicit 'error' mode throws for every class
    for (const broken of cases) {
      expect(() =>
        encodeAnthropicRequest(broken, { unsupportedParams: 'error' }),
      ).toThrowError(/not expressible/);
    }
    // and the default (mode undefined) behaves identically
    for (const broken of cases) {
      expect(() => encodeAnthropicRequest(broken)).toThrowError(/not expressible/);
    }
  });

  test('drops $proxitor reserved keys (anthropic has an empty reserved list)', () => {
    // Arrange
    const ir = decodeAnthropicRequest(loadFixture('anthropic-request-shapes.json'));
    ir.extensions['anthropic-messages'] = {
      ...ir.extensions['anthropic-messages'],
      '$proxitor.route': 'x',
    };
    // Act
    const encoded = encodeAnthropicRequest(ir);
    // Assert
    expect(JSON.parse(encoded)['$proxitor.route']).toBeUndefined();
  });
});
