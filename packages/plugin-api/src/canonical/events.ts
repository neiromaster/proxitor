export type StopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreateTokens?: number;
};

export type PartialUsage = Partial<Usage>;

export type TextDelta = { type: 'text'; text: string };
export type InputJsonDelta = { type: 'input_json'; partialJson: string };
export type ThinkingDelta = { type: 'thinking'; thinking: string };

export type CanonicalError = {
  type: string;
  message: string;
  status: number;
  providerError?: unknown;
};

export type CanonicalEvent =
  | { type: 'message_start'; id: string; model: string }
  | {
      type: 'content_block_start';
      index: number;
      block: { type: 'text' | 'tool_use' | 'thinking'; id?: string; name?: string };
    }
  | {
      type: 'content_block_delta';
      index: number;
      delta: TextDelta | InputJsonDelta | ThinkingDelta;
    }
  | { type: 'signature_delta'; index: number; signature: string }
  | { type: 'content_block_stop'; index: number }
  | {
      type: 'message_delta';
      stopReason?: StopReason;
      stopSequence?: string | null;
      usage?: PartialUsage;
    }
  | { type: 'message_stop' }
  | { type: 'ping' }
  | { type: 'usage'; usage: Usage }
  | { type: 'error'; error: CanonicalError };
