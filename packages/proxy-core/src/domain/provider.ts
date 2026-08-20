import { ENDPOINT_PATHS, WIRE_FORMATS, type WireFormat } from '@proxitor/plugin-api';
import { RoutingConfigError } from './error.js';
import type { PluginListEntry } from './plugin-merge.js';

/** Where a credential comes from (spec §5.1); shape only — file perms are M5. */
export type CredentialRef = string | { readonly env: string } | { readonly file: string };

export type AuthType = 'bearer' | 'x-api-key' | 'header' | 'none';

export type AuthConfig = {
  readonly type: AuthType;
  readonly credential: CredentialRef;
  /** For x-api-key (default 'x-api-key') and header auth (required). */
  readonly headerName?: string;
};

export type MaxTokensField = 'auto' | 'max_tokens' | 'max_completion_tokens';

export type ProviderConfig = {
  readonly id: string;
  /** Everything before the version path — the format adapter owns that. */
  readonly baseUrl: string;
  readonly wireFormat: WireFormat;
  readonly auth: AuthConfig;
  readonly headers?: Readonly<Record<string, string>>;
  readonly plugins?: readonly PluginListEntry[];
  /** Default 'error' (§10 fail-loud policy). */
  readonly unsupportedParams?: 'error' | 'drop';
  /** Default 'auto' (openai-chat adapter heuristic). */
  readonly maxTokensField?: MaxTokensField;
};

const AUTH_TYPES: readonly AuthType[] = ['bearer', 'x-api-key', 'header', 'none'];

/**
 * Fail-loud provider validation (spec §5.1). Throws RoutingConfigError on the
 * first violation; returns void when the config is well-formed.
 */
export function validateProvider(provider: ProviderConfig): void {
  if (typeof provider.id !== 'string' || provider.id.length === 0) {
    throw new RoutingConfigError('provider id must be a non-empty string');
  }
  if (!WIRE_FORMATS.includes(provider.wireFormat)) {
    throw new RoutingConfigError(
      `provider "${provider.id}": unknown wire format '${String(provider.wireFormat)}' (known: ${WIRE_FORMATS.join(', ')})`,
    );
  }
  validateBaseUrl(provider);
  if (
    provider.wireFormat === 'anthropic-messages' &&
    (provider.headers?.['anthropic-version'] ?? '').length === 0
  ) {
    throw new RoutingConfigError(
      `provider "${provider.id}": anthropic-messages providers must set headers["anthropic-version"]`,
    );
  }
  validateAuth(provider);
  if (
    provider.unsupportedParams !== undefined &&
    provider.unsupportedParams !== 'error' &&
    provider.unsupportedParams !== 'drop'
  ) {
    throw new RoutingConfigError(
      `provider "${provider.id}": unsupportedParams must be 'error' or 'drop'`,
    );
  }
  if (
    provider.maxTokensField !== undefined &&
    provider.maxTokensField !== 'auto' &&
    provider.maxTokensField !== 'max_tokens' &&
    provider.maxTokensField !== 'max_completion_tokens'
  ) {
    throw new RoutingConfigError(
      `provider "${provider.id}": maxTokensField must be 'auto', 'max_tokens', or 'max_completion_tokens'`,
    );
  }
}

/**
 * Upstream endpoint URL: baseUrl + the format's endpoint path, with accidental
 * /v1 doubling collapsed. validateProvider is the load-time gate; this collapse
 * is defense-in-depth for programmatic construction.
 */
export function endpointUrl(baseUrl: string, wireFormat: WireFormat): string {
  const joined = `${baseUrl.replace(/\/+$/, '')}${ENDPOINT_PATHS[wireFormat]}`;
  return joined.replace(/\/v1\/v1(?=\/)/g, '/v1');
}

function validateBaseUrl(provider: ProviderConfig): void {
  let url: URL;
  try {
    url = new URL(provider.baseUrl);
  } catch {
    throw new RoutingConfigError(
      `provider "${provider.id}": baseUrl "${provider.baseUrl}" is not a valid URL`,
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RoutingConfigError(
      `provider "${provider.id}": baseUrl protocol must be http or https, got "${url.protocol}"`,
    );
  }
  if (/\/v1\/?$/.test(url.pathname)) {
    const cleanUrl = provider.baseUrl.replace(/\/v1\/?$/, '');
    throw new RoutingConfigError(
      `provider "${provider.id}": baseUrl "${provider.baseUrl}" ends with /v1 — the format adapter owns the version path (${ENDPOINT_PATHS[provider.wireFormat]}), so this would produce a doubled path. Remove the /v1 suffix: use "${cleanUrl}"`,
    );
  }
}

function validateAuth(provider: ProviderConfig): void {
  const auth = provider.auth;
  if (typeof auth !== 'object' || auth === null) {
    throw new RoutingConfigError(`provider "${provider.id}": auth must be an object`);
  }
  if (!AUTH_TYPES.includes(auth.type)) {
    throw new RoutingConfigError(
      `provider "${provider.id}": auth.type must be one of ${AUTH_TYPES.join(', ')}, got '${String(auth.type)}'`,
    );
  }
  validateCredentialRef(provider.id, auth.credential);
  if (auth.type === 'header' && (auth.headerName ?? '').length === 0) {
    throw new RoutingConfigError(
      `provider "${provider.id}": auth.type "header" requires headerName`,
    );
  }
}

function validateCredentialRef(providerId: string, credential: CredentialRef): void {
  if (typeof credential === 'string') {
    if (credential.length === 0) {
      throw new RoutingConfigError(
        `provider "${providerId}": credential must be a non-empty string, { env: string }, or { file: string }`,
      );
    }
    return;
  }
  if (typeof credential !== 'object' || credential === null) {
    throw new RoutingConfigError(
      `provider "${providerId}": credential must be a non-empty string, { env: string }, or { file: string }`,
    );
  }
  const record = credential as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record);
  const single = keys.length === 1 ? keys[0] : undefined;
  const value = single === undefined ? undefined : record[single];
  const valid =
    (single === 'env' || single === 'file') &&
    typeof value === 'string' &&
    value.length > 0;
  if (!valid) {
    throw new RoutingConfigError(
      `provider "${providerId}": credential must be a non-empty string, { env: string }, or { file: string }`,
    );
  }
}
