import type { ProxyConfig } from '../config.js';

export const INJECT_PATHS = new Set([
  '/v1/chat/completions',
  '/v1/responses',
  '/v1/messages',
]);

export type Endpoint = 'chat-completions' | 'responses' | 'messages' | 'other';

const ENDPOINT_MAP: Record<string, Endpoint> = {
  '/v1/chat/completions': 'chat-completions',
  '/v1/responses': 'responses',
  '/v1/messages': 'messages',
};

export function classifyEndpoint(pathname: string): Endpoint {
  return ENDPOINT_MAP[pathname] ?? 'other';
}

export function buildUpstreamUrl(requestUrl: string, config: ProxyConfig): string {
  const { pathname } = new URL(requestUrl);
  return `${config.openrouterBaseUrl}${pathname}`;
}
