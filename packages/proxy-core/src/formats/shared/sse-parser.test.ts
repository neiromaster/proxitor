import { describe, expect, test } from 'vitest';
import { createSseParser } from './sse-parser.js';

describe('createSseParser', () => {
  test('parses event + data messages terminated by blank line', () => {
    // Arrange
    const parser = createSseParser();
    // Act
    const out = parser.push('event: message_start\ndata: {"a":1}\n\n');
    // Assert
    expect(out).toEqual([{ event: 'message_start', data: '{"a":1}' }]);
  });

  test('tolerates missing space after field colon (openai style)', () => {
    // Arrange
    const parser = createSseParser();
    // Act
    const out = parser.push('data:{"id":"x"}\n\n');
    // Assert
    expect(out).toEqual([{ data: '{"id":"x"}' }]);
  });

  test('splits messages across chunks and CRLF line endings', () => {
    // Arrange
    const parser = createSseParser();
    // Act
    const first = parser.push('event: ping\r\nda');
    const second = parser.push('ta: 1\r\n\r\ndata: 2\n\n');
    // Assert
    expect(first).toEqual([]);
    expect(second).toEqual([{ event: 'ping', data: '1' }, { data: '2' }]);
  });

  test('joins multi-line data with newlines and ignores comments', () => {
    // Arrange
    const parser = createSseParser();
    // Act
    const out = parser.push(': keep-alive\ndata: line1\ndata: line2\n\n');
    // Assert
    expect(out).toEqual([{ data: 'line1\nline2' }]);
  });

  test('end() flushes a trailing message without final blank line', () => {
    // Arrange
    const parser = createSseParser();
    // Act
    const pushed = parser.push('data: tail');
    const flushed = parser.end();
    // Assert
    expect(pushed).toEqual([]);
    expect(flushed).toEqual([{ data: 'tail' }]);
  });
});
