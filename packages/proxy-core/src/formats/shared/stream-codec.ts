import type { CanonicalMessage, NodeExtensions } from '@proxitor/plugin-api';
import type { FormatError } from './format-error.js';
import type { WireMeta } from './wire.js';

/** Bidirectional stateful transform of client ↔ canonical IR (spec §9). */
export type FormatAdapter<In, Out> = {
  readonly name: string;
  decode(request: In, stream?: ReadableStream<string>): AsyncIterable<CanonicalMessage>;
  encode(response: Out): AsyncIterable<CanonicalMessage>;
};

/** Encode-side type: captures a full response shape (request codec provides its own). */
export type StreamEncoder = (
  response: unknown,
  extensions?: NodeExtensions,
) => AsyncIterable<CanonicalMessage>;

/** Decode-side: request shape paired with optional SSE decoder. */
export type StreamDecoder = (
  request: unknown,
  stream?: ReadableStream<string>,
) => AsyncIterable<CanonicalMessage>;

/** Codec wire-protocol provenance extracted from `$wire` extension (spec §4.3). */
export type StreamEncodeOptions = {
  readonly wire?: WireMeta;
};

/** Thrown on decode/encode capability gaps; pipeline maps to provider format. */
export type CodecException = FormatError;
