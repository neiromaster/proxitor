import { describe, expect, test } from 'vitest';
import { formatSseEvent, formatSseMessage } from './sse-serializer.js';

describe('formatSseMessage', () => {
  test('renders event + data with trailing blank line', () => {
    // Arrange
    const message = { event: 'message_start', data: '{"a":1}' };
    // Act
    const text = formatSseMessage(message);
    // Assert
    expect(text).toBe('event: message_start\ndata: {"a":1}\n\n');
  });

  test('renders each data line separately', () => {
    // Arrange
    const message = { data: 'line1\nline2' };
    // Act
    const text = formatSseMessage(message);
    // Assert
    expect(text).toBe('data: line1\ndata: line2\n\n');
  });

  test('formatSseEvent stringifies a payload, with or without an event name', () => {
    // Act
    const named = formatSseEvent({ type: 'ping' }, 'ping');
    const unnamed = formatSseEvent({ id: 'x' });
    // Assert
    expect(named).toBe('event: ping\ndata: {"type":"ping"}\n\n');
    expect(unnamed).toBe('data: {"id":"x"}\n\n');
  });
});
