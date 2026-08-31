import type { CanonicalError } from '@proxitor/plugin-api';

/** Client-facing wire-error body (spec §10): anthropic-messages error envelope. */
export function encodeAnthropicError(error: CanonicalError): string {
  return JSON.stringify({
    type: 'error',
    error: { type: error.type, message: error.message },
  });
}
