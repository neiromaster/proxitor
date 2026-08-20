import type { ProviderConfig } from '../domain/index.js';

/** Headers never taken from the client (spec §5.4, D4): auth, sizing, hop-by-hop, core-owned. */
const STRIP_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'x-api-key',
  'host',
  'content-length',
  'content-type',
  'accept',
  'connection',
  'transfer-encoding',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'upgrade',
]);

/** Client headers always forwarded (spec §5.4); x-stainless-* matched by prefix. */
const FORWARD_HEADERS: ReadonlySet<string> = new Set([
  'anthropic-beta',
  'user-agent',
  'x-app',
  'x-title',
  'http-referer',
]);

const FORWARD_PREFIXES: readonly string[] = ['x-stainless-'];

export type UpstreamHeaderOptions = {
  readonly clientHeaders: Readonly<Record<string, string>>;
  readonly provider: ProviderConfig;
  readonly authHeader: { readonly name: string; readonly value: string } | undefined;
  /** Plugin → upstream header channel (D18); protected keys are ignored here (D4). */
  readonly outboundHeaders: Readonly<Record<string, string>> | undefined;
  readonly streaming: boolean;
  /** Extra allowlist from config `server.forwardHeaders` (spec §5.4), wired by the M5 adapter. */
  readonly extraForwardHeaders?: readonly string[];
};

/**
 * Build the upstream header set per §5.4 / D4. Order of application (later wins):
 * allowlisted client headers → plugin outboundHeaders (non-protected only) →
 * provider.headers (protected) → auth header (protected) → core content-type/accept.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Acceptable per brief
export function buildUpstreamHeaders(
  options: UpstreamHeaderOptions,
): Record<string, string> {
  const { clientHeaders, provider, authHeader, outboundHeaders, streaming } = options;

  const forward = new Set(FORWARD_HEADERS);
  for (const name of options.extraForwardHeaders ?? []) {
    forward.add(name.toLowerCase());
  }

  const headers: Record<string, string> = {};

  // 1. Allowlisted client headers; stripped names are never forwarded from the client.
  for (const [name, value] of Object.entries(clientHeaders)) {
    const lower = name.toLowerCase();
    if (STRIP_HEADERS.has(lower)) {
      continue;
    }
    if (forward.has(lower) || FORWARD_PREFIXES.some(prefix => lower.startsWith(prefix))) {
      headers[lower] = value;
    }
  }

  // 2. Plugin channel: may add headers, never override protected ones or re-add stripped ones.
  const protectedKeys = new Set<string>(['content-type', 'accept']);
  if (authHeader !== undefined) {
    protectedKeys.add(authHeader.name);
  }
  for (const name of Object.keys(provider.headers ?? {})) {
    protectedKeys.add(name.toLowerCase());
  }
  for (const [name, value] of Object.entries(outboundHeaders ?? {})) {
    const lower = name.toLowerCase();
    if (!protectedKeys.has(lower) && !STRIP_HEADERS.has(lower)) {
      headers[lower] = value;
    }
  }

  // 3. Provider headers + auth — protected, applied after the plugin channel.
  for (const [name, value] of Object.entries(provider.headers ?? {})) {
    headers[name.toLowerCase()] = value;
  }
  if (authHeader !== undefined) {
    headers[authHeader.name] = authHeader.value;
  }

  // 4. Core-owned transport headers (spec §5.4, D4).
  headers['content-type'] = 'application/json';
  headers.accept = streaming ? 'text/event-stream' : 'application/json';
  return headers;
}
