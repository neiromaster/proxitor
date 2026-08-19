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
