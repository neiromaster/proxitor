import type {
  CanonicalEvent,
  CanonicalMessage,
  CanonicalRequest,
  ClockPort,
  NodeExtensions,
  RandomPort,
} from '@proxitor/plugin-api';
import type { FormatError } from './format-error.js';
import type { WireMeta } from './wire.js';

/** Bidirectional stateful transform of client ↔ canonical IR (spec §9). */
export type FormatAdapterGeneric<In, Out> = {
  readonly name: string;
  decode(request: In, stream?: ReadableStream<string>): AsyncIterable<CanonicalMessage>;
  encode(response: Out): AsyncIterable<CanonicalMessage>;
};

/** Encode-side type: captures a full response shape (request codec provides its own). */
export type LegacyStreamEncoder = (
  response: unknown,
  extensions?: NodeExtensions,
) => AsyncIterable<CanonicalMessage>;

/** Decode-side: request shape paired with optional SSE decoder. */
export type StreamDecoder = (
  request: unknown,
  stream?: ReadableStream<string>,
) => AsyncIterable<CanonicalMessage>;

/** Codec wire-protocol provenance extracted from `$wire` extension (spec §4.3). */
export type LegacyStreamEncodeOptions = {
  readonly wire?: WireMeta;
};

/** Thrown on decode/encode capability gaps; pipeline maps to provider format. */
export type CodecException = FormatError;

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
    options?: StreamEncodeOptions,
  ) => string;
  readonly format: 'anthropic-messages' | 'openai-chat';
};

/** Stream encoder interface - push events and get SSE chunks. */
export type StreamEncoder = { push(event: CanonicalEvent): string; end(): string };

/** Options for stream encoding. */
export type StreamEncodeOptions = {
  readonly model: string;
  readonly clock: ClockPort;
  readonly random: RandomPort;
};
