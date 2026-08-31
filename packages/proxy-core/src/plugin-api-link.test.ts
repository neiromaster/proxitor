import { WIRE_FORMATS } from '@proxitor/plugin-api';
import { describe, expect, test } from 'vitest';

describe('workspace link to @proxitor/plugin-api', () => {
  test('exposes the frozen wire format set', () => {
    // Arrange / Act
    const formats = [...WIRE_FORMATS];
    // Assert
    expect(formats).toEqual(['anthropic-messages', 'openai-chat']);
  });
});
