import type { ProxyConfig } from '../config.js';

export type Endpoint = 'chat-completions' | 'responses' | 'messages' | 'other';

const ENDPOINT_MAP: Record<string, Endpoint> = {
  '/v1/chat/completions': 'chat-completions',
  '/v1/responses': 'responses',
  '/v1/messages': 'messages',
};

export const INJECT_PATHS = new Set(Object.keys(ENDPOINT_MAP));

/** Endpoints that are natively Anthropic (cache_control is always safe regardless of model). */
export const ANTHROPIC_NATIVE_ENDPOINTS: ReadonlySet<Endpoint> = new Set([
  'messages',
  'responses',
]);

export function classifyEndpoint(pathname: string): Endpoint {
  return ENDPOINT_MAP[pathname] ?? 'other';
}

export function buildUpstreamUrl(pathname: string, config: ProxyConfig): string {
  return `${config.openrouterBaseUrl}${pathname}`;
}
