import { describe, expect, it } from 'vitest';
import { encodeAnthropicError } from './encode-error.js';
import { anthropicMessagesAdapter } from './index.js';

describe('encodeAnthropicError', () => {
  it('renders the anthropic wire-error envelope', () => {
    // Arrange
    const error = {
      type: 'invalid_request_error',
      message: 'no binding for model x',
      status: 400,
    };
    // Act
    const body = encodeAnthropicError(error);
    // Assert
    expect(JSON.parse(body)).toEqual({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'no binding for model x' },
    });
  });

  it('drops status and providerError from the client-facing body', () => {
    // Arrange
    const error = {
      type: 'upstream_error',
      message: 'upstream oai responded 429',
      status: 429,
      providerError: { error: { message: 'rate limited' } },
    };
    // Act
    const parsed = JSON.parse(encodeAnthropicError(error)) as {
      error: Record<string, unknown>;
    };
    // Assert
    expect(parsed.error).not.toHaveProperty('status');
    expect(parsed.error).not.toHaveProperty('providerError');
  });

  it('is wired into the assembled adapter', () => {
    // Arrange / Act
    const body = anthropicMessagesAdapter.encodeError({
      type: 'x',
      message: 'm',
      status: 400,
    });
    // Assert
    expect(body).toBe('{"type":"error","error":{"type":"x","message":"m"}}');
  });
});
