import type {
  CanonicalError,
  CanonicalEvent,
  CanonicalRequest,
  ClockPort,
  RandomPort,
} from '@proxitor/plugin-api';

/**
 * Per-provider knobs for outbound request encoding (spec §5.1). `unsupportedParams`
 * (spec §10) governs only OPTIONAL params the outbound format cannot express —
 * required params (anthropic-messages max_tokens) always fail loud.
 */
export type RequestEncodeOptions = {
  readonly maxTokensField?: 'auto' | 'max_tokens' | 'max_completion_tokens';
  readonly unsupportedParams?: 'error' | 'drop';
};

/** Format adapter registry contract (Task 9) - non-generic interface for per-format codec objects. */
export type FormatAdapter = {
  readonly createStreamDecoder: () => {
    push(chunk: string): CanonicalEvent[];
    end(): CanonicalEvent[];
  };
  readonly createStreamEncoder: (options: StreamEncodeOptions) => StreamEncoder;
  readonly decodeRequest: (body: string) => CanonicalRequest;
  readonly decodeResponse: (body: string) => CanonicalEvent[];
  readonly encodeRequest: (
    ir: CanonicalRequest,
    options?: RequestEncodeOptions,
  ) => string;
  readonly encodeError: (error: CanonicalError) => string;
  readonly encodeResponse: (
    ir: Iterable<CanonicalEvent>,
    options: StreamEncodeOptions,
  ) => string;
  readonly format: 'anthropic-messages' | 'openai-chat';
};

/** Stream decoder interface - push SSE chunks and get events. */
export type StreamDecoder = {
  push(chunk: string): CanonicalEvent[];
  end(): CanonicalEvent[];
};

/** Stream encoder interface - push events and get SSE chunks. */
export type StreamEncoder = { push(event: CanonicalEvent): string; end(): string };

/** Options for stream encoding. */
export type StreamEncodeOptions = {
  readonly model: string;
  readonly clock: ClockPort;
  readonly random: RandomPort;
};
