import { describe, expect, it } from 'vitest';
import type { CredentialRef } from '../domain/index.js';
import { type CredentialResolverPort, resolveAuthHeader } from './credentials.js';

const RESOLVER: CredentialResolverPort = {
  resolve: (ref: CredentialRef) =>
    typeof ref === 'string' ? ref : `resolved:${JSON.stringify(ref)}`,
};

describe('resolveAuthHeader', () => {
  it('returns undefined for none-auth without resolving a credential', () => {
    // Arrange
    const auth = { type: 'none' as const, credential: 'unused' };
    // Act
    const header = resolveAuthHeader(auth, RESOLVER);
    // Assert
    expect(header).toBeUndefined();
  });

  it('builds an authorization bearer header', () => {
    // Arrange
    const auth = { type: 'bearer' as const, credential: { env: 'KEY' } };
    // Act
    const header = resolveAuthHeader(auth, RESOLVER);
    // Assert
    expect(header).toEqual({
      name: 'authorization',
      value: 'Bearer resolved:{"env":"KEY"}',
    });
  });

  it('defaults the x-api-key header name', () => {
    // Arrange
    const auth = { type: 'x-api-key' as const, credential: 'sk-test' };
    // Act
    const header = resolveAuthHeader(auth, RESOLVER);
    // Assert
    expect(header).toEqual({ name: 'x-api-key', value: 'sk-test' });
  });

  it('honors custom header names for x-api-key and header auth', () => {
    // Arrange
    const apiKey = resolveAuthHeader(
      { type: 'x-api-key', credential: 'v', headerName: 'x-custom' },
      RESOLVER,
    );
    const custom = resolveAuthHeader(
      { type: 'header', credential: 'v', headerName: 'x-vendor' },
      RESOLVER,
    );
    // Act / Assert
    expect(apiKey).toEqual({ name: 'x-custom', value: 'v' });
    expect(custom).toEqual({ name: 'x-vendor', value: 'v' });
  });

  it('skips header-auth without a headerName (validateProvider makes this unreachable)', () => {
    // Arrange / Act
    const header = resolveAuthHeader({ type: 'header', credential: 'v' }, RESOLVER);
    // Assert
    expect(header).toBeUndefined();
  });
});
