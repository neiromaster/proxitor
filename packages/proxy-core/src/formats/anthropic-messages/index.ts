import type {
  FormatAdapter,
  StreamEncodeOptions,
  StreamEncoder,
} from '../shared/stream-codec.js';
import { decodeAnthropicRequest } from './decode-request.js';
import { decodeAnthropicResponse } from './decode-response.js';
import { createAnthropicStreamDecoder } from './decode-stream.js';
import { encodeAnthropicError } from './encode-error.js';
import { encodeAnthropicRequest } from './encode-request.js';
import { encodeAnthropicResponse } from './encode-response.js';
import { createAnthropicStreamEncoder } from './encode-stream.js';

export const anthropicMessagesAdapter: FormatAdapter = {
  format: 'anthropic-messages',
  decodeRequest: decodeAnthropicRequest,
  encodeRequest: encodeAnthropicRequest,
  encodeError: encodeAnthropicError,
  decodeResponse: decodeAnthropicResponse,
  encodeResponse: (events, _options) => encodeAnthropicResponse(events),
  createStreamDecoder: createAnthropicStreamDecoder,
  createStreamEncoder: (options: StreamEncodeOptions): StreamEncoder =>
    createAnthropicStreamEncoder({ model: options.model, random: options.random }),
};
