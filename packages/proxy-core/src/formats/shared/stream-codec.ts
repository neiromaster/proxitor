import type {
  CanonicalEvent,
  CanonicalRequest,
  ClockPort,
  RandomPort,
} from '@proxitor/plugin-api';

/** Format adapter registry contract (Task 9) - non-generic interface for per-format codec objects. */
export type FormatAdapter = {
  readonly createStreamDecoder: () => {
    push(chunk: string): CanonicalEvent[];
    end(): CanonicalEvent[];
  };
  readonly createStreamEncoder: (options: StreamEncodeOptions) => StreamEncoder;
  readonly decodeRequest: (body: string) => CanonicalRequest;
  readonly decodeResponse: (body: string) => CanonicalEvent[];
  readonly encodeRequest: (ir: CanonicalRequest) => string;
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
