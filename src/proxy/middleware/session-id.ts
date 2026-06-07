const PROXY_SESSION_ID = crypto.randomUUID();

export function deriveSessionId(
  incomingHeaders: Headers,
  mode: 'auto' | 'always' | 'never',
): string | undefined {
  if (mode === 'never') return undefined;
  const fromClient = incomingHeaders.get('x-claude-code-session-id');
  if (fromClient) return fromClient.slice(0, 256);
  // Both 'auto' and 'always' fall back to proxy UUID for maximum sticky routing
  return PROXY_SESSION_ID;
}
