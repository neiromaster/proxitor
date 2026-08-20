import type { CanonicalRequest } from '@proxitor/plugin-api';
import type {
  FormatAdapter,
  RequestEncodeOptions,
  StreamEncodeOptions,
  StreamEncoder,
} from '../shared/stream-codec.js';
import { decodeOpenAiRequest } from './decode-request.js';
import { decodeOpenAiResponse } from './decode-response.js';
import { createOpenAiStreamDecoder } from './decode-stream.js';
import { encodeOpenAiError } from './encode-error.js';
import { encodeOpenAiRequest } from './encode-request.js';
import { encodeOpenAiResponse } from './encode-response.js';
import { createOpenAiStreamEncoder } from './encode-stream.js';

export const openAiChatAdapter: FormatAdapter = {
  format: 'openai-chat',
  decodeRequest: decodeOpenAiRequest,
  encodeRequest: (ir: CanonicalRequest, options?: RequestEncodeOptions) =>
    encodeOpenAiRequest(ir, options),
  encodeError: encodeOpenAiError,
  decodeResponse: decodeOpenAiResponse,
  encodeResponse: (events, options) => encodeOpenAiResponse(events, options),
  createStreamDecoder: createOpenAiStreamDecoder,
  createStreamEncoder: (options: StreamEncodeOptions): StreamEncoder =>
    createOpenAiStreamEncoder(options),
};
