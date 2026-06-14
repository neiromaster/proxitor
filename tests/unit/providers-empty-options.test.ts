import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Models without endpoint data (e.g. OpenRouter aliases like
 * `~anthropic/claude-sonnet-latest`) yield zero providers, which crashes
 * clack.multiselect. selectProvidersByMode must return null instead.
 */
const { mockMultiselect, mockText, mockConfirm, mockLog } = vi.hoisted(() => ({
  mockMultiselect: vi.fn(),
  mockText: vi.fn(),
  mockConfirm: vi.fn(),
  mockLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    step: vi.fn(),
  },
}));

vi.mock('@clack/prompts', () => ({
  multiselect: mockMultiselect,
  text: mockText,
  confirm: mockConfirm,
  isCancel: (val: unknown) => val === Symbol.for('clack:cancel'),
  log: mockLog,
  intro: vi.fn(),
  outro: vi.fn(),
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
}));

describe('selectProvidersByMode with no providers available', () => {
  beforeEach(() => {
    mockMultiselect.mockReset();
    mockText.mockReset();
    mockConfirm.mockReset();
    mockLog.warn.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    'only',
    'order',
    'ignore',
  ] as const)('returns null for mode "%s" instead of crashing', async mode => {
    const { selectProvidersByMode } = await import(
      '../../src/commands/config/providers.js'
    );

    const result = await selectProvidersByMode(mode, []);

    expect(result).toBeNull();
    expect(mockMultiselect).not.toHaveBeenCalled();
  });

  it('warns that no providers are available', async () => {
    const { selectProvidersByMode } = await import(
      '../../src/commands/config/providers.js'
    );

    await selectProvidersByMode('only', []);

    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('No providers available'),
    );
  });
});
