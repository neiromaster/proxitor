import { describe, expect, it } from 'vitest';
import {
  CLIENT_SESSION_ID_HEADER,
  ENDPOINT_PATHS,
  RESERVED_KEYS,
  SESSION_ID_HEADER,
  WIRE_FORMATS,
} from './wire-format.js';

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

describe('ENDPOINT_PATHS', () => {
  it('covers exactly the frozen wire format set', () => {
    // Arrange / Act
    const keys = Object.keys(ENDPOINT_PATHS).sort();

    // Assert
    expect(keys).toEqual([...WIRE_FORMATS].sort());
  });

  it('maps each format to its versioned endpoint', () => {
    // Arrange / Act / Assert
    expect(ENDPOINT_PATHS['anthropic-messages']).toBe('/v1/messages');
    expect(ENDPOINT_PATHS['openai-chat']).toBe('/v1/chat/completions');
  });
});

describe('session id headers', () => {
  it('names the client hint and the wire header, both lowercased', () => {
    // Arrange / Act / Assert
    expect(CLIENT_SESSION_ID_HEADER).toBe('x-claude-code-session-id');
    expect(SESSION_ID_HEADER).toBe('x-session-id');
  });
});
