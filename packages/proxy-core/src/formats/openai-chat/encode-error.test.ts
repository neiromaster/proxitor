import type { CanonicalRequest } from '@proxitor/plugin-api';
import { describe, expect, it } from 'vitest';
import { encodeOpenAiError } from './encode-error.js';
import { openAiChatAdapter } from './index.js';

const IR: CanonicalRequest = {
  model: { logical: 'gpt-5', physical: 'gpt-5' },
  system: [],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  params: { maxTokens: { value: 64, source: 'max_tokens' } },
  stream: false,
  extensions: {},
};

describe('encodeOpenAiError', () => {
  it('renders the openai wire-error envelope', () => {
    // Arrange
    const error = {
      type: 'invalid_request_error',
      message: 'no binding for model x',
      status: 400,
    };
    // Act
    const body = encodeOpenAiError(error);
    // Assert
    expect(JSON.parse(body)).toEqual({
      error: { message: 'no binding for model x', type: 'invalid_request_error' },
    });
  });

  it('drops status and providerError from the client-facing body', () => {
    // Arrange
    const error = {
      type: 'upstream_error',
      message: 'upstream ant responded 500',
      status: 500,
      providerError: { type: 'error', error: { message: 'overloaded' } },
    };
    // Act
    const parsed = JSON.parse(encodeOpenAiError(error)) as {
      error: Record<string, unknown>;
    };
    // Assert
    expect(parsed.error).not.toHaveProperty('status');
    expect(parsed.error).not.toHaveProperty('providerError');
  });

  it('is wired into the assembled adapter', () => {
    // Arrange / Act
    const body = openAiChatAdapter.encodeError({ type: 'x', message: 'm', status: 400 });
    // Assert
    expect(body).toBe('{"error":{"message":"m","type":"x"}}');
  });

  it('flows maxTokensField through encodeRequest options', () => {
    // Arrange / Act
    const body = openAiChatAdapter.encodeRequest(IR, { maxTokensField: 'max_tokens' });
    // Assert
    expect(JSON.parse(body).max_tokens).toBe(64);
  });
});
