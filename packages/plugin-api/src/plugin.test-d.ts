import { describe, expectTypeOf, it } from 'vitest';
import type { CanonicalEvent } from './canonical/events.js';
import type { CanonicalRequest } from './canonical/request.js';
import type { PluginContext, ProxyPlugin, ShortCircuit } from './plugin.js';

describe('plugin contract (spec §7)', () => {
  it('ShortCircuit error and events are mutually exclusive', () => {
    const withError: ShortCircuit = {
      shortCircuit: true,
      status: 429,
      error: { type: 'rate_limit_error', message: 'slow down', status: 429 },
    };
    const withEvents: ShortCircuit = { shortCircuit: true, status: 200, events: [] };
    // @ts-expect-error — both set is forbidden (r3 P1)
    const both: ShortCircuit = {
      shortCircuit: true,
      status: 200,
      error: withError.error,
      events: [],
    };
    expectTypeOf(withError.status).toEqualTypeOf<number>();
    expectTypeOf(withEvents.events).toEqualTypeOf<CanonicalEvent[] | undefined>();
  });

  it('PluginContext carries exactly the four services + config (D9 blindness)', () => {
    expectTypeOf<PluginContext>().toEqualTypeOf<{
      requestId: string;
      logger: import('./ports.js').LoggerPort;
      clock: import('./ports.js').ClockPort;
      random: import('./ports.js').RandomPort;
      config: unknown;
    }>();
  });

  it('all hooks are optional and correctly typed', () => {
    expectTypeOf<ProxyPlugin['onRequest']>().toEqualTypeOf<
      | ((
          ctx: PluginContext,
          req: CanonicalRequest,
        ) => Promise<CanonicalRequest | ShortCircuit> | (CanonicalRequest | ShortCircuit))
      | undefined
    >();
    expectTypeOf<ProxyPlugin['transformStream']>().toEqualTypeOf<
      | ((
          ctx: PluginContext,
          events: AsyncIterable<CanonicalEvent>,
        ) => AsyncIterable<CanonicalEvent>)
      | undefined
    >();
    expectTypeOf<ProxyPlugin['reservedKeys']>().toEqualTypeOf<
      | Partial<Record<import('./wire-format.js').WireFormat, readonly string[]>>
      | undefined
    >();
  });

  it('a name-only object is a valid plugin', () => {
    const plugin: ProxyPlugin = { name: 'noop' };
    expectTypeOf(plugin.name).toEqualTypeOf<string>();
  });
});
