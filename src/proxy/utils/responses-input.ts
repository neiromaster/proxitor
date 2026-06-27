import { randomUUID } from 'node:crypto';
import type { TriState } from '../../config-schema.js';
import { classifyEndpoint } from '../paths.js';

/**
 * Whether to normalize a Responses-api body. Mirrors the other tri-states:
 * `auto` acts only on /v1/responses, `always` acts everywhere, `skip` never.
 */
export function shouldNormalizeResponses(mode: TriState, path: string): boolean {
  if (mode === 'skip') return false;
  if (mode === 'always') return true;
  return classifyEndpoint(path) === 'responses';
}

type NormalizerState = { instructions: unknown; next: unknown[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Flatten a Responses content value (string or block array) to plain text. */
function contentToText(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    const text = isPlainObject(block) ? (block.text as unknown) : undefined;
    if (typeof text === 'string') parts.push(text);
  }
  return parts.length > 0 ? parts.join('\n') : undefined;
}

function appendInstructions(current: unknown, text: string): string {
  return typeof current === 'string' ? `${current}\n\n${text}` : text;
}

/** Tag a role-bearing message item and complete assistant-history metadata. */
function tagMessageItem(obj: Record<string, unknown>): boolean {
  let changed = false;
  if (typeof obj.role === 'string' && obj.type === undefined) {
    obj.type = 'message';
    changed = true;
  }
  if (obj.type === 'message' && obj.role === 'assistant') {
    if (obj.id === undefined) {
      obj.id = `msg_${randomUUID().slice(0, 12)}`;
      changed = true;
    }
    if (obj.status === undefined) {
      obj.status = 'completed';
      changed = true;
    }
  }
  return changed;
}

/**
 * Lift a `role: "system"` item: OpenRouter Responses has no system role in
 * `input`, so its text moves to `instructions`. Items with no extractable text
 * (image-only/empty) can't be represented there and are dropped — keeping them
 * as `role: "system"` would reproduce the rejection this normalizer exists to fix.
 */
function handleSystemItem(obj: Record<string, unknown>, state: NormalizerState): void {
  const text = contentToText(obj.content);
  if (text !== undefined) {
    state.instructions = appendInstructions(state.instructions, text);
  }
  // No text → nothing to lift, and role:"system" can't stay in input: drop it.
}

/**
 * Make a Responses body satisfy OpenRouter's `input` schema. Each item is a
 * `type`-discriminated union, so items missing `type` (OpenAI infers "message")
 * are rejected as `invalid_prompt`. Also relocates `role: "system"` items to
 * `instructions` and synthesizes the `id`/`status` assistant history requires.
 * Idempotent; returns whether the body changed.
 */
export function normalizeResponsesInput(body: Record<string, unknown>): boolean {
  const input = body.input;
  if (!Array.isArray(input)) return false;

  let mutated = false;
  const state: NormalizerState = { instructions: body.instructions, next: [] };

  for (const raw of input) {
    if (!isPlainObject(raw)) {
      state.next.push(raw);
      continue;
    }
    if (raw.role === 'system') {
      handleSystemItem(raw, state);
      mutated = true;
      continue;
    }
    if (tagMessageItem(raw)) mutated = true;
    state.next.push(raw);
  }

  if (mutated) {
    body.input = state.next;
    if (state.instructions !== undefined) body.instructions = state.instructions;
  }
  return mutated;
}
