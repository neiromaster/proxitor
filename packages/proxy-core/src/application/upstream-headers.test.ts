import { describe, expect, it } from 'vitest';
import type { ProviderConfig } from '../domain/index.js';
import { buildUpstreamHeaders } from './upstream-headers.js';

const PROVIDER: ProviderConfig = {
  id: 'ant',
  baseUrl: 'https://ant.example.com',
  wireFormat: 'anthropic-messages',
  auth: { type: 'x-api-key', credential: 'sk-ant' },
  headers: { 'anthropic-version': '2023-06-01', 'x-team': 'core' },
};

const AUTH = { name: 'x-api-key', value: 'secret' };

const CLIENT_HEADERS: Readonly<Record<string, string>> = {
  authorization: 'Bearer client-should-not-leak',
  'x-api-key': 'client-key-should-not-leak',
  host: 'proxitor.local',
  'content-length': '123',
  connection: 'keep-alive',
  'transfer-encoding': 'chunked',
  accept: 'application/json',
  'anthropic-beta': 'prompt-caching-2024-07-31',
  'user-agent': 'unit-test/1.0',
  'x-app': 'my-app',
  'x-title': 'my-title',
  'http-referer': 'https://example.com',
  'x-stainless-retry-count': '2',
  'x-random-header': 'denied-by-default',
  'x-custom-allowed': 'extra-allowlist-value',
};

function build(overrides: Partial<Parameters<typeof buildUpstreamHeaders>[0]> = {}) {
  return buildUpstreamHeaders({
    clientHeaders: CLIENT_HEADERS,
    provider: PROVIDER,
    authHeader: AUTH,
    outboundHeaders: undefined,
    streaming: false,
    ...overrides,
  });
}

describe('buildUpstreamHeaders', () => {
  it('strips auth, sizing, and hop-by-hop headers from the client', () => {
    // Arrange / Act
    const headers = build();
    // Assert
    expect(headers.authorization).toBeUndefined();
    expect(headers['x-api-key']).toBe('secret'); // overwritten by auth, not the client's
    expect(headers.host).toBeUndefined();
    expect(headers['content-length']).toBeUndefined();
    expect(headers.connection).toBeUndefined();
    expect(headers['transfer-encoding']).toBeUndefined();
  });

  it('forwards exactly the allowlisted client headers and the x-stainless- prefix', () => {
    // Arrange / Act
    const headers = build();
    // Assert
    expect(headers['anthropic-beta']).toBe('prompt-caching-2024-07-31');
    expect(headers['user-agent']).toBe('unit-test/1.0');
    expect(headers['x-app']).toBe('my-app');
    expect(headers['x-title']).toBe('my-title');
    expect(headers['http-referer']).toBe('https://example.com');
    expect(headers['x-stainless-retry-count']).toBe('2');
    expect(headers['x-random-header']).toBeUndefined();
  });

  it('does not forward the client accept — core owns it', () => {
    // Arrange / Act
    const headers = build();
    // Assert
    expect(headers.accept).toBe('application/json');
  });

  it('sets accept by streaming mode', () => {
    // Arrange / Act / Assert
    expect(build({ streaming: true }).accept).toBe('text/event-stream');
    expect(build({ streaming: false }).accept).toBe('application/json');
  });

  it('applies provider headers and core transport headers', () => {
    // Arrange / Act
    const headers = build();
    // Assert
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['x-team']).toBe('core');
    expect(headers['content-type']).toBe('application/json');
  });

  it('lets plugin outboundHeaders add new headers but never override protected ones', () => {
    // Arrange
    const outboundHeaders = {
      'x-plugin-marker': 'yes',
      'x-api-key': 'plugin-forged-auth',
      'anthropic-version': 'plugin-forged',
      'content-type': 'text/plain',
      accept: 'text/plain',
      authorization: 'plugin-forged',
    };
    // Act
    const headers = build({ outboundHeaders });
    // Assert
    expect(headers['x-plugin-marker']).toBe('yes');
    expect(headers['x-api-key']).toBe('secret');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['content-type']).toBe('application/json');
    expect(headers.accept).toBe('application/json');
    expect(headers.authorization).toBeUndefined();
  });

  it('extends the allowlist via extraForwardHeaders, lowercased', () => {
    // Arrange — CLIENT_HEADERS carries 'x-custom-allowed': 'extra-allowlist-value'
    // Act
    const headers = build({ extraForwardHeaders: ['X-Custom-Allowed'] });
    // Assert
    expect(headers['x-custom-allowed']).toBe('extra-allowlist-value');
  });

  it('works without an auth header (none-auth providers)', () => {
    // Arrange / Act
    const headers = build({ authHeader: undefined });
    // Assert
    expect(headers['x-api-key']).toBeUndefined();
  });
});
