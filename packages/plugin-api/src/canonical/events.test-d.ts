import { describe, expectTypeOf, it } from 'vitest';
import type { CanonicalError, CanonicalEvent, StopReason } from './events.js';

describe('CanonicalEvent vocabulary (spec §4.2)', () => {
  it('signature_delta exists as a distinct event (r2 P0-3)', () => {
    const event: CanonicalEvent = { type: 'signature_delta', index: 0, signature: '' };
    if (event.type === 'signature_delta') {
      expectTypeOf(event.signature).toEqualTypeOf<string>();
    }
  });

  it('error event carries CanonicalError and is part of the stream', () => {
    const event: CanonicalEvent = {
      type: 'error',
      error: { type: 'upstream_error', message: 'boom', status: 502 },
    };
    if (event.type === 'error') {
      expectTypeOf(event.error).toEqualTypeOf<CanonicalError>();
    }
  });

  it('stop reasons match the mapping table', () => {
    expectTypeOf<StopReason>().toEqualTypeOf<
      'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use'
    >();
  });

  it('message_delta usage is partial', () => {
    const event: CanonicalEvent = { type: 'message_delta' };
    if (event.type === 'message_delta') {
      expectTypeOf(event.usage).toEqualTypeOf<
        | Partial<{
            inputTokens: number;
            outputTokens: number;
            cacheReadTokens?: number;
            cacheCreateTokens?: number;
          }>
        | undefined
      >();
    }
  });
});
