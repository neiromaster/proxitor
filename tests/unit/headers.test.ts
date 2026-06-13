import { describe, expect, it } from 'vitest';
import { filterHeaders, lowercaseKeys, STRIP_REQUEST } from '../../src/proxy/headers.js';

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
  it('strips blocklisted and hop-by-hop headers, keeps the rest', () => {
    // Arrange
    const incoming = new Headers({
      'content-type': 'application/json',
      authorization: 'Bearer secret',
      connection: 'keep-alive',
      'x-custom': 'value',
    });

    // Act
    const result = filterHeaders(incoming, STRIP_REQUEST);

    // Assert
    expect(result).toEqual({ 'content-type': 'application/json', 'x-custom': 'value' });
  });
});
