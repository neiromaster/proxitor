import { createHash } from 'node:crypto';
import { classifyEndpoint } from '../paths.js';

const PROXY_SESSION_ID = crypto.randomUUID();

type Message = { role?: string; content?: unknown };

export function extractConversationFingerprint(
  parsedBody: Record<string, unknown>,
  path: string,
): string | null {
  let system: unknown;
  let user: unknown;

  switch (classifyEndpoint(path)) {
    case 'responses':
      system = parsedBody.instructions;
      user = parsedBody.input;
      break;
    case 'messages': {
      system = parsedBody.system;
      const messages = parsedBody.messages;
      if (Array.isArray(messages)) {
        const firstUser = messages.find(
          (m: Message) => m.role === 'user' && m.content != null,
        );
        user = firstUser?.content;
      }
      break;
    }
    default: {
      const messages = parsedBody.messages;
      if (Array.isArray(messages)) {
        const firstSystem = messages.find(
          (m: Message) =>
            (m.role === 'system' || m.role === 'developer') && m.content != null,
        );
        const firstUser = messages.find(
          (m: Message) => m.role === 'user' && m.content != null,
        );
        system = firstSystem?.content;
        user = firstUser?.content;
      }
    }
  }

  if (system == null && user == null) return null;

  const hash = createHash('sha256');
  hash.update(String(parsedBody.model ?? ''));
  if (system != null) hash.update(JSON.stringify(system));
  if (user != null) hash.update(JSON.stringify(user));
  return hash.digest('hex');
}

/**
 * Derive session ID for sticky routing from multiple sources:
 *
 * 1. `x-claude-code-session-id` header — Claude Code
 * 2. `session_id` from parsed body — Codex CLI (Responses API)
 * 3. hash(model + system + user) — content-based, per-conversation
 * 4. crypto.randomUUID() — fallback when no content available
 */
export function deriveSessionId(
  incomingHeaders: Headers,
  parsedBody: Record<string, unknown> | undefined,
  path: string,
  mode: 'auto' | 'always' | 'never',
): string | undefined {
  if (mode === 'never') return undefined;

  const fromHeader = incomingHeaders.get('x-claude-code-session-id');
  if (fromHeader) return fromHeader.slice(0, 256);

  if (
    parsedBody &&
    typeof parsedBody.session_id === 'string' &&
    parsedBody.session_id.length > 0
  ) {
    return parsedBody.session_id;
  }

  if (parsedBody) {
    const fingerprint = extractConversationFingerprint(parsedBody, path);
    if (fingerprint) return fingerprint;
  }

  return PROXY_SESSION_ID;
}
