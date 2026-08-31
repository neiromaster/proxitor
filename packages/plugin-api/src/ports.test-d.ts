import { describe, expectTypeOf, it } from 'vitest';
import type { ClockPort, LoggerPort, RandomPort } from './ports.js';

describe('ports (spec §8, plugin-facing subset)', () => {
  it('a plain shim satisfies LoggerPort', () => {
    const shim: LoggerPort = {
      info: (_message, _context) => undefined,
      warn: (_message, _context) => undefined,
      error: (_message, _context) => undefined,
      debug: (_message, _context) => undefined,
    };
    expectTypeOf(shim).toExtend<LoggerPort>();
  });

  it('ClockPort and RandomPort are minimal', () => {
    const clock: ClockPort = { now: () => 0 };
    const random: RandomPort = { uuid: () => '00000000-0000-0000-0000-000000000000' };
    expectTypeOf(clock.now()).toEqualTypeOf<number>();
    expectTypeOf(random.uuid()).toEqualTypeOf<string>();
  });
});
