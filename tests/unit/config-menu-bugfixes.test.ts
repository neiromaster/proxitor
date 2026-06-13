/**
 * Regression tests for config menu bug fixes.
 *
 * Each describe block corresponds to a numbered finding from bugs.md.
 * Tests are written BEFORE the fix (TDD) — they should FAIL initially,
 * then pass after the implementation is corrected.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelOverride } from '../../src/config-schema.js';
import { createTempDir, removeTempDir } from '../helpers.js';

// ---------------------------------------------------------------------------
// Mocks — ALL hoisted and mock calls at module top level (vitest requirement)
// ---------------------------------------------------------------------------

const { mockAskTriState, mockAskCacheControlTtl } = vi.hoisted(() => ({
  mockAskTriState: vi.fn(),
  mockAskCacheControlTtl: vi.fn(),
}));

const { mockSelectRoutingMode } = vi.hoisted(() => ({
  mockSelectRoutingMode: vi.fn(),
}));

const { mockSetModelOverride, mockGetModelOverrides, mockRequireConfigPath } = vi.hoisted(
  () => ({
    mockSetModelOverride: vi.fn(),
    mockGetModelOverrides: vi.fn(() => ({})),
    mockRequireConfigPath: vi.fn((p?: string) => p ?? '/tmp/test-config.yaml'),
  }),
);

vi.mock('../../src/commands/config/prompts.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../src/commands/config/prompts.js')>();
  return {
    ...actual,
    askTriState: mockAskTriState,
    askCacheControlTtl: mockAskCacheControlTtl,
  };
});

vi.mock('@clack/prompts', () => ({
  isCancel: (val: unknown) => val === Symbol.for('clack:cancel'),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), step: vi.fn() },
  intro: vi.fn(),
  outro: vi.fn(),
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
  select: vi.fn(),
  confirm: vi.fn(),
  text: vi.fn(),
}));

vi.mock('../../src/commands/config/providers.js', () => ({
  selectRoutingMode: mockSelectRoutingMode,
  fetchProvidersForModel: vi.fn(),
  selectProvidersByMode: vi.fn(),
}));

vi.mock('../../src/commands/config/config.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../src/commands/config/config.js')>();
  return {
    ...actual,
    setModelOverride: mockSetModelOverride,
    getModelOverrides: mockGetModelOverrides,
    requireConfigPath: mockRequireConfigPath,
  };
});

vi.mock('../../src/openrouter/models.js', () => ({
  fetchModels: vi.fn(),
  formatPrice: vi.fn(),
}));

// Import AFTER mocks are set up
const { editCacheControl } = await import('../../src/commands/config/edit.js');
const { cacheControlCommand } = await import(
  '../../src/commands/config/cache-control.js'
);
const { connectionMenuCommand } = await import('../../src/commands/config/connection.js');

// Real (un-mocked) config utilities for file-level tests
const { setGlobalConfigFields, readConfigRaw } = await import(
  '../../src/commands/config/config.js'
);

// ===========================================================================
// Bug #1a (P0) — TTL silently lost on cancel in editCacheControl (per-model)
// ===========================================================================

describe('Bug #1a: TTL loss on cancel in editCacheControl', () => {
  it('preserves existing TTL when user cancels TTL prompt', async () => {
    const current: ModelOverride = {
      cacheControl: 'always',
      cacheControlTtl: '1h',
    };

    // User re-selects 'always', then presses Escape on TTL prompt
    mockAskTriState.mockResolvedValueOnce('always');
    mockAskCacheControlTtl.mockResolvedValueOnce(Symbol.for('clack:cancel')); // ← cancel

    const result = await editCacheControl(current);

    expect(result.cacheControl).toBe('always');
    expect(result.cacheControlTtl).toBe('1h'); // ← MUST be preserved
  });

  it('preserves existing TTL=5m when user cancels TTL prompt', async () => {
    const current: ModelOverride = {
      cacheControl: 'always',
      cacheControlTtl: '5m',
    };

    mockAskTriState.mockResolvedValueOnce('always');
    mockAskCacheControlTtl.mockResolvedValueOnce(Symbol.for('clack:cancel'));

    const result = await editCacheControl(current);

    expect(result.cacheControlTtl).toBe('5m');
  });

  it('does not add TTL when user cancels and no TTL existed', async () => {
    const current: ModelOverride = {
      cacheControl: 'always',
    };

    mockAskTriState.mockResolvedValueOnce('always');
    mockAskCacheControlTtl.mockResolvedValueOnce(Symbol.for('clack:cancel'));

    const result = await editCacheControl(current);

    expect(result.cacheControl).toBe('always');
    expect(result.cacheControlTtl).toBeUndefined();
  });

  it('sets new TTL when user picks one', async () => {
    const current: ModelOverride = {
      cacheControl: 'always',
      cacheControlTtl: '5m',
    };

    mockAskTriState.mockResolvedValueOnce('always');
    mockAskCacheControlTtl.mockResolvedValueOnce('1h');

    const result = await editCacheControl(current);

    expect(result.cacheControl).toBe('always');
    expect(result.cacheControlTtl).toBe('1h');
  });

  it('removes TTL when user picks "reset"', async () => {
    const current: ModelOverride = {
      cacheControl: 'always',
      cacheControlTtl: '1h',
    };

    mockAskTriState.mockResolvedValueOnce('always');
    mockAskCacheControlTtl.mockResolvedValueOnce('reset');

    const result = await editCacheControl(current);

    expect(result.cacheControl).toBe('always');
    expect(result.cacheControlTtl).toBeUndefined();
  });

  it('never mode keeps TTL (decoupled — TTL always asked)', async () => {
    const current: ModelOverride = {
      cacheControl: 'always',
      cacheControlTtl: '1h',
    };

    // 'never' no longer skips the TTL prompt — TTL is decoupled and always asked
    mockAskTriState.mockResolvedValueOnce('never');
    mockAskCacheControlTtl.mockResolvedValueOnce('1h');

    const result = await editCacheControl(current);

    expect(result.cacheControl).toBe('never');
    expect(result.cacheControlTtl).toBe('1h'); // TTL preserved/set independently
  });

  it('returns current unchanged when tri-state is cancelled', async () => {
    const current: ModelOverride = {
      cacheControl: 'always',
      cacheControlTtl: '1h',
    };

    mockAskTriState.mockResolvedValueOnce(Symbol.for('clack:cancel')); // ← cancel on tri-state

    const result = await editCacheControl(current);

    expect(result).toEqual(current);
  });
});

// ===========================================================================
// Bug #1b (P0) — TTL silently lost on cancel in cacheControlCommand (global)
// ===========================================================================

describe('Bug #1b: TTL loss on cancel in cacheControlCommand (global)', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    configPath = join(tmpDir, 'proxitor.config.yaml');
    writeFileSync(configPath, 'cacheControl: always\ncacheControlTtl: 1h\nport: 8828\n');
    mockRequireConfigPath.mockReturnValue(configPath);
  });

  afterEach(() => {
    removeTempDir(tmpDir);
    vi.clearAllMocks();
  });

  it('applies cacheControl change but preserves TTL when user cancels TTL prompt', async () => {
    mockAskTriState.mockResolvedValueOnce('always');
    mockAskCacheControlTtl.mockResolvedValueOnce(Symbol.for('clack:cancel')); // ← cancel

    await cacheControlCommand({ configPath });

    const raw = readConfigRaw(configPath);
    expect(raw).toContain('cacheControl: always');
    expect(raw).toContain('cacheControlTtl: 1h'); // ← MUST be preserved
  });

  it('preserves existing TTL=5m when user cancels TTL prompt', async () => {
    writeFileSync(configPath, 'cacheControl: always\ncacheControlTtl: 5m\nport: 8828\n');
    mockAskTriState.mockResolvedValueOnce('always');
    mockAskCacheControlTtl.mockResolvedValueOnce(Symbol.for('clack:cancel'));

    await cacheControlCommand({ configPath });

    const raw = readConfigRaw(configPath);
    expect(raw).toContain('cacheControlTtl: 5m');
  });

  it('does not add TTL when user cancels and no TTL existed', async () => {
    writeFileSync(configPath, 'cacheControl: always\nport: 8828\n');
    mockAskTriState.mockResolvedValueOnce('always');
    mockAskCacheControlTtl.mockResolvedValueOnce(Symbol.for('clack:cancel'));

    await cacheControlCommand({ configPath });

    const raw = readConfigRaw(configPath);
    expect(raw).toContain('cacheControl: always');
    expect(raw).not.toContain('cacheControlTtl');
  });

  it('updates TTL when user picks a new one', async () => {
    mockAskTriState.mockResolvedValueOnce('always');
    mockAskCacheControlTtl.mockResolvedValueOnce('5m');

    await cacheControlCommand({ configPath });

    const raw = readConfigRaw(configPath);
    expect(raw).toContain('cacheControlTtl: 5m');
  });

  it('keeps TTL when user picks never (TTL decoupled — always asked)', async () => {
    // 'never' no longer skips TTL — it is always asked
    mockAskTriState.mockResolvedValueOnce('never');
    mockAskCacheControlTtl.mockResolvedValueOnce('1h');

    await cacheControlCommand({ configPath });

    const raw = readConfigRaw(configPath);
    expect(raw).toContain('cacheControl: never');
    expect(raw).toContain('cacheControlTtl: 1h');
  });

  it('removes TTL when user explicitly picks reset', async () => {
    mockAskTriState.mockResolvedValueOnce('always');
    mockAskCacheControlTtl.mockResolvedValueOnce('reset');

    await cacheControlCommand({ configPath });

    const raw = readConfigRaw(configPath);
    expect(raw).toContain('cacheControl: always');
    expect(raw).not.toContain('cacheControlTtl');
  });

  it('returns without writing when user cancels tri-state', async () => {
    mockAskTriState.mockResolvedValueOnce(Symbol.for('clack:cancel'));

    await cacheControlCommand({ configPath });

    const raw = readConfigRaw(configPath);
    expect(raw).toContain('cacheControl: always'); // unchanged
    expect(raw).toContain('cacheControlTtl: 1h'); // unchanged
  });

  it('applies cacheControl change only when TTL cancelled — even if mode changed', async () => {
    // User picks 'auto' (different from current 'always'), then cancels TTL
    mockAskTriState.mockResolvedValueOnce('auto');
    mockAskCacheControlTtl.mockResolvedValueOnce(Symbol.for('clack:cancel'));

    await cacheControlCommand({ configPath });

    const raw = readConfigRaw(configPath);
    // cacheControl is applied; TTL is preserved (untouched)
    expect(raw).toContain('cacheControl: auto');
    expect(raw).toContain('cacheControlTtl: 1h');
  });
});

// ===========================================================================
// Bug #3  (P1) — Non-atomic double write in cache-control
// ===========================================================================

describe('Bug #3: Batch write — setGlobalConfigFields', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    configPath = join(tmpDir, 'proxitor.config.yaml');
    writeFileSync(configPath, 'port: 8828\n');
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  it('writes multiple fields in a single read-parse-write cycle', () => {
    setGlobalConfigFields(configPath, {
      cacheControl: 'always',
      cacheControlTtl: '1h',
    });

    const raw = readConfigRaw(configPath);
    // Both fields must be present in the same file
    expect(raw).toContain('cacheControl: always');
    expect(raw).toContain('cacheControlTtl: 1h');
  });

  it('deletes fields when value is undefined', () => {
    writeFileSync(configPath, 'cacheControl: always\ncacheControlTtl: 1h\nport: 8828\n');

    setGlobalConfigFields(configPath, {
      cacheControl: undefined,
      cacheControlTtl: undefined,
    });

    const raw = readConfigRaw(configPath);
    expect(raw).not.toContain('cacheControl');
    expect(raw).not.toContain('cacheControlTtl');
    // Non-touched fields remain
    expect(raw).toContain('port: 8828');
  });

  it('handles mixed set and delete', () => {
    writeFileSync(configPath, 'cacheControl: always\ncacheControlTtl: 1h\n');

    setGlobalConfigFields(configPath, {
      cacheControl: 'never',
      cacheControlTtl: undefined,
    });

    const raw = readConfigRaw(configPath);
    expect(raw).toContain('cacheControl: never');
    expect(raw).not.toContain('cacheControlTtl');
  });
});

// ===========================================================================
// Connection menu — one-shot, ESC cancels without config changes
// ===========================================================================

describe('Connection menu: one-shot per visit', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    configPath = join(tmpDir, 'proxitor.config.yaml');
    writeFileSync(configPath, 'port: 8828\nhost: 0.0.0.0\n');
    mockRequireConfigPath.mockReturnValue(configPath);
  });

  afterEach(() => {
    removeTempDir(tmpDir);
    vi.clearAllMocks();
  });

  it('returns without writing when user cancels field selection', async () => {
    const { select: mockSelect } = await import('@clack/prompts');
    (mockSelect as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      Symbol.for('clack:cancel'),
    );

    await connectionMenuCommand({ configPath });

    const raw = readConfigRaw(configPath);
    expect(raw).toContain('port: 8828'); // unchanged
  });

  it('returns without writing when user cancels value prompt', async () => {
    const { select: mockSelect, text: mockText } = await import('@clack/prompts');
    (mockSelect as ReturnType<typeof vi.fn>).mockResolvedValueOnce('port');
    (mockText as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      Symbol.for('clack:cancel'),
    );

    await connectionMenuCommand({ configPath });

    const raw = readConfigRaw(configPath);
    expect(raw).toContain('port: 8828'); // unchanged
  });
});

// ===========================================================================
// Bug #6  (P2) — Skip no longer a short path — extra prompts
// ===========================================================================

describe('Bug #6: Skip short-circuit in add override', () => {
  it('skips session/cache prompts when routing mode is "skip"', async () => {
    const { configureProviderAndSave } = await import('../../src/commands/config/add.js');

    // User picks 'skip' for provider routing
    mockSelectRoutingMode.mockResolvedValueOnce('skip');
    // confirmAndSave → user confirms save
    const { select: mockSelect } = await import('@clack/prompts');
    const { confirm: mockConfirm } = await import('@clack/prompts');
    // First select is "What next?" in confirmAndSave → 'save'
    (mockSelect as ReturnType<typeof vi.fn>).mockResolvedValueOnce('save');
    (mockConfirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    await configureProviderAndSave('/tmp/test.yaml', {} as any, 'test-model', false);

    // The key assertion: clack.confirm should NOT have been called with
    // "Configure session routing..." or "Configure cache control..."
    // (those come from collectSession/collectCache)
    const confirmCalls = (mockConfirm as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: any[]) => c[0]?.message ?? '',
    );
    expect(confirmCalls).not.toContainEqual(
      expect.stringContaining('Configure session routing'),
    );

    // setModelOverride called with empty or minimal override (no sessionId/cacheControl)
    expect(mockSetModelOverride).toHaveBeenCalled();
    const savedOverride = mockSetModelOverride.mock.calls[0]![2];
    expect(savedOverride.sessionId).toBeUndefined();
    expect(savedOverride.cacheControl).toBeUndefined();
  });
});
