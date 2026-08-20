import type { CanonicalError } from '@proxitor/plugin-api';

/** Client-facing wire-error body (spec §10): openai-chat error envelope. */
export function encodeOpenAiError(error: CanonicalError): string {
  return JSON.stringify({
    error: { message: error.message, type: error.type },
  });
}
