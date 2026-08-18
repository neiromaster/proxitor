import { describe, expect, it } from 'vitest';
import { RESERVED_KEYS, WIRE_FORMATS } from './wire-format.js';

describe('wire formats', () => {
  it('exposes both v1 formats', () => {
    expect(WIRE_FORMATS).toEqual(['anthropic-messages', 'openai-chat']);
  });

  it('reserves openrouter routing keys under $proxitor. prefix (spec §4.3)', () => {
    expect(RESERVED_KEYS['openai-chat']).toEqual([
      '$proxitor.provider',
      '$proxitor.models',
      '$proxitor.route',
      '$proxitor.transforms',
    ]);
  });

  it('reserves nothing on anthropic-messages in v1', () => {
    expect(RESERVED_KEYS['anthropic-messages']).toEqual([]);
  });
});
