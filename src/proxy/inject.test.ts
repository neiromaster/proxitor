import { describe, expect, it } from 'vitest';
import {
  extractModel,
  injectBodyFields,
  injectProvider,
  isAnthropicModel,
} from './inject.js';

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

describe('isAnthropicModel', () => {
  it('matches claude-* prefix', () => {
    expect(isAnthropicModel('claude-sonnet-4-6')).toBe(true);
    expect(isAnthropicModel('claude-opus-4')).toBe(true);
  });

  it('matches anthropic/claude-* prefix', () => {
    expect(isAnthropicModel('anthropic/claude-sonnet-4-6')).toBe(true);
    expect(isAnthropicModel('anthropic/claude-opus-4-20250514')).toBe(true);
  });

  it('matches models containing claude', () => {
    expect(isAnthropicModel('google/claude-3-opus')).toBe(true);
  });

  it('rejects non-Anthropic models', () => {
    expect(isAnthropicModel('gpt-4o')).toBe(false);
    expect(isAnthropicModel('deepseek/deepseek-r1')).toBe(false);
    expect(isAnthropicModel('meta-llama/llama-3')).toBe(false);
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
      'Request body is not valid JSON; cannot inject',
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
      'Request body is empty; cannot inject',
    );
  });
});

describe('injectBodyFields', () => {
  const encode = (obj: unknown) =>
    new TextEncoder().encode(JSON.stringify(obj)).buffer as ArrayBuffer;
  const decode = (buf: ArrayBuffer) =>
    JSON.parse(new TextDecoder().decode(buf)) as Record<string, unknown>;

  it('injects provider only', () => {
    const body = encode({ model: 'test', messages: [] });
    const result = injectBodyFields(body, { providerRouting: { only: ['anthropic'] } });
    expect(decode(result).provider).toEqual({ only: ['anthropic'] });
  });

  it('injects cache_control only', () => {
    const body = encode({ model: 'claude-sonnet-4-6', messages: [] });
    const result = injectBodyFields(body, { cacheControl: true });
    const parsed = decode(result);
    expect(parsed.cache_control).toEqual({ type: 'ephemeral' });
    expect(parsed.provider).toBeUndefined();
  });

  it('injects session_id only', () => {
    const body = encode({ model: 'test', messages: [] });
    const result = injectBodyFields(body, { sessionId: 'session-abc' });
    const parsed = decode(result);
    expect(parsed.session_id).toBe('session-abc');
  });

  it('injects all three together', () => {
    const body = encode({ model: 'claude-sonnet-4-6', messages: [] });
    const result = injectBodyFields(body, {
      providerRouting: { only: ['anthropic'] },
      cacheControl: true,
      sessionId: 'session-123',
    });
    const parsed = decode(result);
    expect(parsed.provider).toEqual({ only: ['anthropic'] });
    expect(parsed.cache_control).toEqual({ type: 'ephemeral' });
    expect(parsed.session_id).toBe('session-123');
  });

  it('does not inject cache_control when already present', () => {
    const body = encode({
      model: 'test',
      messages: [],
      cache_control: { type: 'ephemeral', ttl: '1h' },
    });
    const result = injectBodyFields(body, { cacheControl: true });
    expect(decode(result).cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('does not inject session_id when already present', () => {
    const body = encode({ model: 'test', messages: [], session_id: 'existing' });
    const result = injectBodyFields(body, { sessionId: 'new-session' });
    expect(decode(result).session_id).toBe('existing');
  });

  it('always overwrites provider', () => {
    const body = encode({ model: 'test', provider: { only: ['old'] } });
    const result = injectBodyFields(body, { providerRouting: { only: ['new'] } });
    expect(decode(result).provider).toEqual({ only: ['new'] });
  });

  it('does not inject cache_control when param is false', () => {
    const body = encode({ model: 'test', messages: [] });
    const result = injectBodyFields(body, { cacheControl: false });
    expect(decode(result).cache_control).toBeUndefined();
  });

  it('preserves original JSON structure', () => {
    const body = encode({
      model: 'test',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });
    const result = injectBodyFields(body, {
      providerRouting: { only: ['anthropic'] },
      cacheControl: true,
    });
    const parsed = decode(result);
    expect(parsed.model).toBe('test');
    expect(parsed.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(parsed.stream).toBe(true);
  });

  it('throws for empty body', () => {
    expect(() => injectBodyFields(new ArrayBuffer(0), {})).toThrow(
      'Request body is empty; cannot inject',
    );
  });

  it('throws for invalid JSON', () => {
    const body = new TextEncoder().encode('not json').buffer as ArrayBuffer;
    expect(() => injectBodyFields(body, { cacheControl: true })).toThrow(
      'Request body is not valid JSON; cannot inject',
    );
  });
});
