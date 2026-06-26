import { describe, expect, it } from 'vitest';
import { filterHeaders, lowercaseKeys, STRIP_REQUEST } from './headers.js';

describe('lowercaseKeys', () => {
  it('lowercases every header key', () => {
    // Arrange
    const input = {
      'Content-Type': 'application/json',
      'X-Custom-Header': 'value',
      alreadylower: 'kept',
    };

    // Act
    const result = lowercaseKeys(input);

    // Assert
    expect(result).toEqual({
      'content-type': 'application/json',
      'x-custom-header': 'value',
      alreadylower: 'kept',
    });
  });

  it('does not mutate the input object', () => {
    // Arrange
    const input = { 'Content-Type': 'application/json' };

    // Act
    lowercaseKeys(input);

    // Assert
    expect(Object.keys(input)).toEqual(['Content-Type']);
  });

  it('folds case-variant keys into a single lowercase key (last wins)', () => {
    // Arrange — two keys that differ only by case, as a user-config slip might produce.
    const input = { 'Content-Type': 'first', 'CONTENT-TYPE': 'second' };

    // Act
    const result = lowercaseKeys(input);

    // Assert
    expect(Object.keys(result)).toEqual(['content-type']);
    expect(result['content-type']).toBe('second');
  });
});

describe('filterHeaders', () => {
  it('should strip authorization and host from incoming headers', () => {
    const incoming = new Headers({
      authorization: 'Bearer old-token',
      host: 'example.com',
      'x-forwarded-for': '1.2.3.4',
    });
    const headers = filterHeaders(incoming, STRIP_REQUEST);
    expect(headers.authorization).toBeUndefined();
    expect(headers.host).toBeUndefined();
    expect(headers['x-forwarded-for']).toBe('1.2.3.4');
  });

  it('passes through x-claude-code-session-id (stripped later by middleware)', () => {
    const incoming = new Headers({
      'x-claude-code-session-id': 'session-abc123',
    });
    const headers = filterHeaders(incoming, STRIP_REQUEST);
    expect(headers['x-claude-code-session-id']).toBe('session-abc123');
  });

  it('passes through x-session-id (stripped later by middleware)', () => {
    const incoming = new Headers({
      'x-session-id': 'client-session-456',
    });
    const headers = filterHeaders(incoming, STRIP_REQUEST);
    expect(headers['x-session-id']).toBe('client-session-456');
  });

  it('passes through both session headers simultaneously', () => {
    const incoming = new Headers({
      'x-claude-code-session-id': 'session-abc',
      'x-session-id': 'session-xyz',
    });
    const headers = filterHeaders(incoming, STRIP_REQUEST);
    expect(headers['x-claude-code-session-id']).toBe('session-abc');
    expect(headers['x-session-id']).toBe('session-xyz');
  });

  it('should strip hop-by-hop headers', () => {
    const incoming = new Headers({
      connection: 'keep-alive',
      'keep-alive': 'timeout=5',
      'transfer-encoding': 'chunked',
      'x-custom': 'value',
    });
    const headers = filterHeaders(incoming, STRIP_REQUEST);
    expect(headers.connection).toBeUndefined();
    expect(headers['keep-alive']).toBeUndefined();
    expect(headers['transfer-encoding']).toBeUndefined();
    expect(headers['x-custom']).toBe('value');
  });

  it('should strip x-api-key and content-length', () => {
    const incoming = new Headers({
      'x-api-key': 'secret',
      'content-length': '1234',
    });
    const headers = filterHeaders(incoming, STRIP_REQUEST);
    expect(headers['x-api-key']).toBeUndefined();
    expect(headers['content-length']).toBeUndefined();
  });
});
