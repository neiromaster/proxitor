import type { AuthConfig, CredentialRef } from '../domain/index.js';

/**
 * Resolves CredentialRef shapes (string / {env} / {file}) to secret values.
 * The M5 adapter does the I/O (env vars, file reads); tests use fakes (D3).
 */
export type CredentialResolverPort = {
  resolve(ref: CredentialRef): string;
};

/** Auth header for the upstream request (spec §5.1); undefined = no auth header. */
/** Auth header for the upstream request (spec §5.1); undefined = no auth header. */
export function resolveAuthHeader(
  auth: AuthConfig,
  resolver: CredentialResolverPort,
): { readonly name: string; readonly value: string } | undefined {
  if (auth.type === 'none') {
    return undefined;
  }
  const secret = resolver.resolve(auth.credential);
  switch (auth.type) {
    case 'bearer':
      return { name: 'authorization', value: `Bearer ${secret}` };
    case 'x-api-key':
      return { name: auth.headerName ?? 'x-api-key', value: secret };
    case 'header':
      // headerName is guaranteed by validateProvider; guard keeps the builder total.
      return auth.headerName === undefined
        ? undefined
        : { name: auth.headerName, value: secret };
  }
}
