import { describe, expect, it } from 'vitest';
import { extractModel, injectProvider } from './inject.js';

describe('extractModel', () => {
  it('should extract model from valid JSON body', () => {
    const body = new TextEncoder().encode(
      JSON.stringify({ model: 'claude-sonnet-4-6', messages: [] }),
    );
    expect(extractModel(body.buffer as ArrayBuffer)).toBe('claude-sonnet-4-6');
  });

  it('should return undefined for empty body', () => {
    expect(extractModel(new ArrayBuffer(0))).toBeUndefined();
  });

  it('should return undefined for body without model field', () => {
    const body = new TextEncoder().encode(JSON.stringify({ messages: [] }));
    expect(extractModel(body.buffer as ArrayBuffer)).toBeUndefined();
  });

  it('should return undefined for invalid JSON', () => {
    const body = new TextEncoder().encode('not json');
    expect(extractModel(body.buffer as ArrayBuffer)).toBeUndefined();
  });

  it('should return undefined when model is not a string', () => {
    const body = new TextEncoder().encode(JSON.stringify({ model: 42 }));
    expect(extractModel(body.buffer as ArrayBuffer)).toBeUndefined();
  });
});

describe('injectProvider', () => {
  it('should inject provider routing into valid JSON body', () => {
    const body = new TextEncoder().encode(
      JSON.stringify({ model: 'test', messages: [] }),
    );
    const routing = { only: ['anthropic'] };
    const result = injectProvider(body.buffer as ArrayBuffer, routing);
    const parsed = JSON.parse(new TextDecoder().decode(result));
    expect(parsed).toEqual({ model: 'test', messages: [], provider: routing });
  });

  it('should overwrite existing provider field', () => {
    const body = new TextEncoder().encode(
      JSON.stringify({ model: 'test', provider: { only: ['old'] } }),
    );
    const routing = { only: ['new'] };
    const result = injectProvider(body.buffer as ArrayBuffer, routing);
    const parsed = JSON.parse(new TextDecoder().decode(result));
    expect(parsed.provider).toEqual(routing);
  });

  it('should throw with descriptive message for invalid JSON', () => {
    const body = new TextEncoder().encode('not json');
    expect(() => injectProvider(body.buffer as ArrayBuffer, {})).toThrow(
      'Request body is not valid JSON; cannot inject provider',
    );
  });

  it('should include original parse error as cause', () => {
    const body = new TextEncoder().encode('{invalid}');
    try {
      injectProvider(body.buffer as ArrayBuffer, {});
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).cause).toBeInstanceOf(SyntaxError);
    }
  });

  it('should throw for empty body', () => {
    expect(() => injectProvider(new ArrayBuffer(0), {})).toThrow(
      'Request body is empty; cannot inject provider',
    );
  });
});
