import { describe, expect, test } from 'vitest';
import { RoutingConfigError } from './error.js';
import { endpointUrl, type ProviderConfig, validateProvider } from './provider.js';

function baseProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'openai-prod',
    baseUrl: 'https://api.openai.com',
    wireFormat: 'openai-chat',
    auth: { type: 'bearer', credential: { env: 'OPENAI_API_KEY' } },
    ...overrides,
  };
}

describe('validateProvider', () => {
  test('accepts a minimal openai provider', () => {
    // Arrange
    const provider = baseProvider();

    // Act / Assert
    expect(() => validateProvider(provider)).not.toThrow();
  });

  test('accepts an anthropic provider with anthropic-version header', () => {
    // Arrange
    const provider = baseProvider({
      id: 'anthropic-direct',
      baseUrl: 'https://api.anthropic.com',
      wireFormat: 'anthropic-messages',
      auth: { type: 'x-api-key', credential: { env: 'ANTHROPIC_API_KEY' } },
      headers: { 'anthropic-version': '2023-06-01' },
    });

    // Act / Assert
    expect(() => validateProvider(provider)).not.toThrow();
  });

  test('rejects an empty id', () => {
    // Arrange
    const provider = baseProvider({ id: '' });

    // Act / Assert
    expect(() => validateProvider(provider)).toThrow(RoutingConfigError);
  });

  test('rejects an unknown wireFormat', () => {
    // Arrange
    const provider = baseProvider({
      wireFormat: 'openai-responses' as ProviderConfig['wireFormat'],
    });

    // Act / Assert
    expect(() => validateProvider(provider)).toThrow(/unknown wire format/);
  });

  test('rejects an unparseable baseUrl', () => {
    // Arrange
    const provider = baseProvider({ baseUrl: 'not-a-url' });

    // Act / Assert
    expect(() => validateProvider(provider)).toThrow(/not a valid URL/);
  });

  test('rejects a non-http protocol', () => {
    // Arrange
    const provider = baseProvider({ baseUrl: 'ftp://api.openai.com' });

    // Act / Assert
    expect(() => validateProvider(provider)).toThrow(/http or https/);
  });

  test('rejects a baseUrl ending with /v1 and names the fix', () => {
    // Arrange
    const provider = baseProvider({ baseUrl: 'https://api.openai.com/v1' });

    // Act / Assert
    expect(() => validateProvider(provider)).toThrow(/ends with \/v1/);
    expect(() => validateProvider(provider)).toThrow(/https:\/\/api\.openai\.com"$/m);
  });

  test('rejects a baseUrl ending with /v1/ (trailing slash)', () => {
    // Arrange
    const provider = baseProvider({ baseUrl: 'https://api.openai.com/v1/' });

    // Act / Assert
    expect(() => validateProvider(provider)).toThrow(/ends with \/v1/);
  });

  test('rejects a baseUrl with query parameters', () => {
    // Arrange
    const provider = baseProvider({ baseUrl: 'https://api.openai.com?key=1' });

    // Act / Assert
    expect(() => validateProvider(provider)).toThrow(RoutingConfigError);
    expect(() => validateProvider(provider)).toThrow(
      /baseUrl.*must not contain query parameters/,
    );
  });

  test('rejects a baseUrl with a fragment', () => {
    // Arrange
    const provider = baseProvider({ baseUrl: 'https://api.openai.com#frag' });

    // Act / Assert
    expect(() => validateProvider(provider)).toThrow(RoutingConfigError);
    expect(() => validateProvider(provider)).toThrow(
      /baseUrl.*must not contain a fragment/,
    );
  });

  test('rejects a baseUrl ending with uppercase /V1', () => {
    // Arrange
    const provider = baseProvider({ baseUrl: 'https://api.openai.com/V1' });

    // Act / Assert
    expect(() => validateProvider(provider)).toThrow(/ends with \/v1/);
  });

  test('anthropic provider without anthropic-version is rejected', () => {
    // Arrange
    const provider = baseProvider({
      wireFormat: 'anthropic-messages',
    });

    // Act / Assert
    expect(() => validateProvider(provider)).toThrow(/anthropic-version/);
  });

  test('rejects an unknown auth.type', () => {
    // Arrange
    const provider = baseProvider({
      auth: { type: 'basic' as ProviderConfig['auth']['type'], credential: 'k' },
    });

    // Act / Assert
    expect(() => validateProvider(provider)).toThrow(/auth\.type/);
  });

  test('rejects a malformed credential object', () => {
    // Arrange
    const provider = baseProvider({
      auth: { type: 'bearer', credential: { env: 'A', file: 'B' } as never },
    });

    // Act / Assert
    expect(() => validateProvider(provider)).toThrow(/credential/);
  });

  test('rejects an empty env credential', () => {
    // Arrange
    const provider = baseProvider({
      auth: { type: 'bearer', credential: { env: '' } },
    });

    // Act / Assert
    expect(() => validateProvider(provider)).toThrow(/credential/);
  });

  test('auth type header requires headerName', () => {
    // Arrange
    const missing = baseProvider({
      auth: { type: 'header', credential: { env: 'K' } },
    });
    const present = baseProvider({
      auth: { type: 'header', credential: { env: 'K' }, headerName: 'x-custom' },
    });

    // Act / Assert
    expect(() => validateProvider(missing)).toThrow(/headerName/);
    expect(() => validateProvider(present)).not.toThrow();
  });

  test('rejects an unsupportedParams value outside the set', () => {
    // Arrange
    const provider = baseProvider({ unsupportedParams: 'warn' as never });

    // Act / Assert
    expect(() => validateProvider(provider)).toThrow(/unsupportedParams/);
  });

  test('rejects a maxTokensField value outside the set', () => {
    // Arrange
    const provider = baseProvider({ maxTokensField: 'max_output' as never });

    // Act / Assert
    expect(() => validateProvider(provider)).toThrow(/maxTokensField/);
  });

  test('rejects non-string header values', () => {
    // Arrange
    const providerWithNumber = baseProvider({
      headers: { 'x-custom': 123 as never },
    });
    const providerWithObject = baseProvider({
      headers: { 'x-custom': { value: 'test' } as never },
    });

    // Act / Assert
    expect(() => validateProvider(providerWithNumber)).toThrow(RoutingConfigError);
    expect(() => validateProvider(providerWithNumber)).toThrow(
      /provider "openai-prod": headers\["x-custom"\] must be a string/,
    );
    expect(() => validateProvider(providerWithObject)).toThrow(
      /provider "openai-prod": headers\["x-custom"\] must be a string/,
    );
  });

  test('rejects numeric anthropic-version value', () => {
    // Arrange
    const provider = baseProvider({
      id: 'anthropic-direct',
      wireFormat: 'anthropic-messages',
      auth: { type: 'x-api-key', credential: { env: 'ANTHROPIC_API_KEY' } },
      headers: { 'anthropic-version': 2023 as never },
    });

    // Act / Assert
    expect(() => validateProvider(provider)).toThrow(RoutingConfigError);
    expect(() => validateProvider(provider)).toThrow(
      /provider "anthropic-direct": headers\["anthropic-version"\] must be a string/,
    );
  });
});

describe('endpointUrl', () => {
  test('joins baseUrl with the format endpoint path', () => {
    // Arrange / Act / Assert
    expect(endpointUrl('https://api.openai.com', 'openai-chat')).toBe(
      'https://api.openai.com/v1/chat/completions',
    );
    expect(endpointUrl('https://api.anthropic.com', 'anthropic-messages')).toBe(
      'https://api.anthropic.com/v1/messages',
    );
  });

  test('strips trailing slashes from baseUrl', () => {
    // Arrange / Act / Assert
    expect(endpointUrl('https://openrouter.ai/api/', 'openai-chat')).toBe(
      'https://openrouter.ai/api/v1/chat/completions',
    );
  });

  test('collapses accidental /v1 doubling (defense-in-depth)', () => {
    // Arrange / Act / Assert
    expect(endpointUrl('https://api.openai.com/v1', 'openai-chat')).toBe(
      'https://api.openai.com/v1/chat/completions',
    );
    expect(endpointUrl('https://api.anthropic.com/v1/', 'anthropic-messages')).toBe(
      'https://api.anthropic.com/v1/messages',
    );
  });
});
