import type { StopReason } from '@proxitor/plugin-api';

/** Shared openai↔canonical stop-reason translation tables (spec §4.1). */

/** Canonical stop reason → openai `finish_reason` (encoders). */
export const REVERSE_STOP: Record<string, string> = {
  end_turn: 'stop',
  max_tokens: 'length',
  tool_use: 'tool_calls',
  stop_sequence: 'stop',
};

/** openai `finish_reason` → canonical stop reason (decoders); unknown → `end_turn` at the call site. */
export const STOP_MAP: Record<string, StopReason> = {
  stop: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
  function_call: 'tool_use',
  content_filter: 'end_turn',
};

/** Stop reasons expressible in the canonical IR (anthropic vocabulary). */
export const CANONICAL_STOP_REASONS: ReadonlySet<string> = new Set<string>([
  'end_turn',
  'max_tokens',
  'stop_sequence',
  'tool_use',
]);
