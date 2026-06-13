import { createHash } from 'node:crypto';
import type { TriState } from '../../config-schema.js';
import type { ParsedRequestBody } from '../context.js';
import { classifyEndpoint } from '../paths.js';

const PROXY_SESSION_ID = crypto.randomUUID();

type Message = { role?: string; content?: unknown };

function firstContent(messages: unknown, ...roles: string[]): unknown {
  if (!Array.isArray(messages)) return undefined;
  return (messages as Message[]).find(
    m => roles.includes(m.role ?? '') && m.content != null,
  )?.content;
}

/** Returns '' for non-serializable values (e.g. BigInt). */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

export function extractConversationFingerprint(
  parsedBody: ParsedRequestBody,
  path: string,
): string | null {
  let system: unknown;
  let user: unknown;

  switch (classifyEndpoint(path)) {
    case 'responses':
      system = parsedBody.instructions;
      user = parsedBody.input;
      break;
    case 'messages':
      system = parsedBody.system;
      user = firstContent(parsedBody.messages, 'user');
      break;
    default:
      system = firstContent(parsedBody.messages, 'system', 'developer');
      user = firstContent(parsedBody.messages, 'user');
  }

  if (system == null && user == null) return null;

  const hash = createHash('sha256');
  hash.update(String(parsedBody.model ?? ''));
  if (system != null) hash.update(safeStringify(system));
  if (user != null) hash.update(safeStringify(user));
  return hash.digest('hex');
}

export function deriveSessionId(
  incomingHeaders: Headers,
  parsedBody: ParsedRequestBody | undefined,
  path: string,
  mode: TriState,
): string | undefined {
  if (mode === 'never') return undefined;

  if (mode === 'auto') {
    const fromHeader = incomingHeaders.get('x-claude-code-session-id');
    if (fromHeader) return fromHeader.slice(0, 256);

    if (
      parsedBody &&
      typeof parsedBody.session_id === 'string' &&
      parsedBody.session_id.length > 0
    ) {
      return parsedBody.session_id;
    }
  }

  if (parsedBody) {
    const fingerprint = extractConversationFingerprint(parsedBody, path);
    if (fingerprint) return fingerprint;
  }

  return PROXY_SESSION_ID;
}
