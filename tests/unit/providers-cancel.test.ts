/**
 * Bugfix #5: Cancel on "Allow fallbacks?" uses default (true)
 *
 * Tests that selectOrderedProviders accepts the default (true) when the user
 * cancels the "Allow fallbacks?" confirm prompt — instead of returning null
 * and discarding all prior provider selections.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted() ensures mock functions exist before vi.mock factory runs.
const { mockMultiselect, mockText, mockConfirm } = vi.hoisted(() => ({
  mockMultiselect: vi.fn(),
  mockText: vi.fn(),
  mockConfirm: vi.fn(),
}));

vi.mock('@clack/prompts', () => ({
  multiselect: mockMultiselect,
  text: mockText,
  confirm: mockConfirm,
  isCancel: (val: unknown) => val === Symbol.for('clack:cancel'),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), step: vi.fn() },
  intro: vi.fn(),
  outro: vi.fn(),
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
}));

describe('Bugfix #5: selectOrderedProviders cancel on fallbacks confirm', () => {
  beforeEach(() => {
    mockMultiselect.mockReset();
    mockText.mockReset();
    mockConfirm.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns provider config with allowFallbacks=true when confirm is cancelled', async () => {
    const { selectProvidersByMode } = await import(
      '../../src/commands/config/providers.js'
    );

    const providerOptions = [
      { value: 'anthropic', label: 'Anthropic' },
      { value: 'openai', label: 'OpenAI' },
    ];

    // Step 1: multiselect picks providers
    mockMultiselect.mockResolvedValueOnce(['anthropic', 'openai']);
    // Step 2: text inputs for priorities
    mockText
      .mockResolvedValueOnce('1') // priority for anthropic
      .mockResolvedValueOnce('2'); // priority for openai
    // Step 3: confirm "Allow fallbacks?" — user cancels (returns cancel symbol)
    mockConfirm.mockResolvedValueOnce(Symbol.for('clack:cancel'));

    const result = await selectProvidersByMode('order', providerOptions);

    // The fix: cancel on a confirm with initialValue=true should accept the
    // default, NOT return null (which would destroy all provider input).
    expect(result).not.toBeNull();
    expect(result).toEqual({
      provider: {
        order: ['anthropic', 'openai'],
        allowFallbacks: true, // default accepted on cancel
      },
    });
  });

  it('returns provider config with allowFallbacks=false when user explicitly says no', async () => {
    const { selectProvidersByMode } = await import(
      '../../src/commands/config/providers.js'
    );

    const providerOptions = [{ value: 'anthropic', label: 'Anthropic' }];

    mockMultiselect.mockResolvedValueOnce(['anthropic']);
    mockText.mockResolvedValueOnce('1');
    // User explicitly chooses "no" (false)
    mockConfirm.mockResolvedValueOnce(false);

    const result = await selectProvidersByMode('order', providerOptions);

    expect(result).toEqual({
      provider: {
        order: 'anthropic',
        allowFallbacks: false,
      },
    });
  });

  it('returns provider config with allowFallbacks=true when user says yes', async () => {
    const { selectProvidersByMode } = await import(
      '../../src/commands/config/providers.js'
    );

    const providerOptions = [
      { value: 'deepinfra', label: 'DeepInfra' },
      { value: 'openai', label: 'OpenAI' },
    ];

    mockMultiselect.mockResolvedValueOnce(['deepinfra', 'openai']);
    mockText.mockResolvedValueOnce('2').mockResolvedValueOnce('1');
    mockConfirm.mockResolvedValueOnce(true);

    const result = await selectProvidersByMode('order', providerOptions);

    expect(result).toEqual({
      provider: {
        order: ['openai', 'deepinfra'],
        allowFallbacks: true,
      },
    });
  });
});
