import { WIRE_FORMATS, type WireFormat } from '@proxitor/plugin-api';
import { anthropicMessagesAdapter } from './anthropic-messages/index.js';
import { openAiChatAdapter } from './openai-chat/index.js';
import type { FormatAdapter } from './shared/stream-codec.js';

export const FORMAT_ADAPTERS: Readonly<Record<WireFormat, FormatAdapter>> = {
  'anthropic-messages': anthropicMessagesAdapter,
  'openai-chat': openAiChatAdapter,
};

export function getFormat(format: WireFormat): FormatAdapter {
  const adapter = FORMAT_ADAPTERS[format];
  if (adapter === undefined) {
    throw new Error(
      `unknown wire format '${format}' (known: ${WIRE_FORMATS.join(', ')})`,
    );
  }
  return adapter;
}

export type { FormatAdapter } from './shared/stream-codec.js';
