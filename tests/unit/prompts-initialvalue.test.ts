/**
 * Pins clack.select initialValue for each ask* prompt: an unset (inheriting)
 * override highlights "Reset / inherit", not a stale false/'auto'/'5m' default.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TriState } from '../../src/config-schema.js';

vi.mock('@clack/prompts', () => ({
  isCancel: (val: unknown) => val === Symbol.for('clack:cancel'),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), step: vi.fn() },
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  select: vi.fn(),
}));

const HINTS: Record<TriState, string> = { auto: 'a', always: 'b', skip: 'c' };

const { askNormalizeVolatileSystem, askTriState, askCacheControlTtl } = await import(
  '../../src/commands/config/prompts.js'
);
const { select: mockSelect } = await import('@clack/prompts');
const select = mockSelect as ReturnType<typeof vi.fn>;

function initialValueOf(): unknown {
  return select.mock.calls.at(-1)?.[0]?.initialValue;
}

describe('askNormalizeVolatileSystem — initialValue', () => {
  beforeEach(() => {
    select.mockReset();
    // Resolve to cancel so the prompt returns immediately; we only inspect args.
    select.mockResolvedValue(Symbol.for('clack:cancel'));
  });

  it('highlights "Reset / inherit" when current is undefined (inheriting) + removable', async () => {
    await askNormalizeVolatileSystem('msg', undefined, { removable: true });
    expect(initialValueOf()).toBe('reset');
  });

  it('highlights the current value when explicitly set', async () => {
    await askNormalizeVolatileSystem('msg', true, { removable: true });
    expect(initialValueOf()).toBe(true);

    await askNormalizeVolatileSystem('msg', false, { removable: true });
    expect(initialValueOf()).toBe(false);
  });

  it('falls back to false when undefined and NOT removable (no reset option)', async () => {
    await askNormalizeVolatileSystem('msg', undefined, {});
    expect(initialValueOf()).toBe(false);
  });
});

describe('askTriState — initialValue', () => {
  beforeEach(() => {
    select.mockReset();
    select.mockResolvedValue(Symbol.for('clack:cancel'));
  });

  it('highlights "Reset / inherit" when current is undefined + removable', async () => {
    await askTriState('msg', undefined, HINTS, { removable: true });
    expect(initialValueOf()).toBe('reset');
  });

  it('highlights the current mode when explicitly set', async () => {
    await askTriState('msg', 'always', HINTS, { removable: true });
    expect(initialValueOf()).toBe('always');
  });

  it('falls back to "auto" when undefined and NOT removable', async () => {
    await askTriState('msg', undefined, HINTS, {});
    expect(initialValueOf()).toBe('auto');
  });
});

describe('askCacheControlTtl — initialValue', () => {
  beforeEach(() => {
    select.mockReset();
    select.mockResolvedValue(Symbol.for('clack:cancel'));
  });

  it('highlights "Reset / inherit" when current is undefined + removable', async () => {
    await askCacheControlTtl(undefined, { removable: true });
    expect(initialValueOf()).toBe('reset');
  });

  it('highlights the current TTL when explicitly set', async () => {
    await askCacheControlTtl('1h', { removable: true });
    expect(initialValueOf()).toBe('1h');
  });

  it('falls back to "5m" when undefined and NOT removable', async () => {
    await askCacheControlTtl(undefined, {});
    expect(initialValueOf()).toBe('5m');
  });
});
