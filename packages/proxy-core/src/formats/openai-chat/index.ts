import type { CanonicalRequest } from '@proxitor/plugin-api';
import type {
  FormatAdapter,
  StreamEncodeOptions,
  StreamEncoder,
} from '../shared/stream-codec.js';
import { decodeOpenAiRequest } from './decode-request.js';
import { decodeOpenAiResponse } from './decode-response.js';
import { createOpenAiStreamDecoder } from './decode-stream.js';
import { encodeOpenAiRequest } from './encode-request.js';
import { encodeOpenAiResponse } from './encode-response.js';
import {
  createOpenAiStreamEncoder,
  type StreamEncodeOptions as OpenAiStreamEncodeOptions,
} from './encode-stream.js';

export const openAiChatAdapter: FormatAdapter = {
  format: 'openai-chat',
  decodeRequest: decodeOpenAiRequest,
  encodeRequest: (ir: CanonicalRequest) => encodeOpenAiRequest(ir),
  decodeResponse: decodeOpenAiResponse,
  encodeResponse: (events, options) =>
    encodeOpenAiResponse(events, options as unknown as OpenAiStreamEncodeOptions),
  createStreamDecoder: createOpenAiStreamDecoder,
  createStreamEncoder: (options: StreamEncodeOptions): StreamEncoder =>
    createOpenAiStreamEncoder(options as unknown as OpenAiStreamEncodeOptions),
};
