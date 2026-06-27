import type { TriState } from '../../config-schema.js';
import { classifyEndpoint } from '../paths.js';

/**
 * Whether to lift stray `role:"system"` items out of `messages`. Mirrors the
 * other tri-states: `auto` acts only on /v1/messages, `always` acts everywhere,
 * `skip` never.
 */
export function shouldNormalizeMessages(mode: TriState, path: string): boolean {
  if (mode === 'skip') return false;
  if (mode === 'always') return true;
  return classifyEndpoint(path) === 'messages';
}

type TextBlock = Record<string, unknown> & { text?: unknown };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Flatten a message content value (string or block array) to plain text. */
function contentToText(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    const text = isPlainObject(block) ? (block as TextBlock).text : undefined;
    if (typeof text === 'string') parts.push(text);
  }
  return parts.length > 0 ? parts.join('\n') : undefined;
}

/**
 * Append lifted system text to a top-level `system` value, preserving its form:
 * a block array stays an array (new `{type:"text"}` block), a string stays a
 * string, and a missing system starts as a plain string.
 */
function appendSystemText(current: unknown, text: string): unknown {
  if (Array.isArray(current)) {
    return [...current, { type: 'text', text }];
  }
  if (typeof current === 'string') {
    return current.length > 0 ? `${current}\n\n${text}` : text;
  }
  return text;
}

/**
 * Lift every `role:"system"` item in `messages` into the top-level `system`
 * field. The Anthropic Messages API allows only `user`/`assistant` in
 * `messages` — a stray `role:"system"` (e.g. injected hook output like a
 * SessionStart payload) is rejected by strict Anthropic-format providers
 * (OpenRouter → GLM et al.) with a 400 on `messages[n].role`. System content
 * belongs in the top-level `system`, so its text is merged there and the item
 * is dropped from `messages`, which also preserves user/assistant alternation.
 * Items with no extractable text are dropped. Idempotent; returns whether the
 * body changed.
 */
export function liftSystemMessages(body: Record<string, unknown>): boolean {
  const messages = body.messages;
  if (!Array.isArray(messages)) return false;

  let system = body.system;
  const next: unknown[] = [];
  let mutated = false;

  for (const raw of messages) {
    if (isPlainObject(raw) && raw.role === 'system') {
      const text = contentToText(raw.content);
      if (text !== undefined) system = appendSystemText(system, text);
      // role:"system" can never stay in messages — always drop, even when empty.
      mutated = true;
      continue;
    }
    next.push(raw);
  }

  if (mutated) {
    body.messages = next;
    body.system = system;
  }
  return mutated;
}
