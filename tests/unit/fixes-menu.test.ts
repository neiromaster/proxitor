/**
 * Coverage for src/commands/config/fixes-menu.ts:
 * globalFixesMenu / perModelFixesMenu / fixesCommand.
 *
 * The lever commands (normalize-responses/messages) and per-model levers
 * (editNormalizeResponses/Messages) are mocked; config.ts + equality run for
 * real so we assert the persist-vs-skip semantics against overridesEqual.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTempDir, removeTempDir } from '../helpers.js';

const {
  mockNormResponses,
  mockNormMessages,
  mockEditResponses,
  mockEditMessages,
  mockSetModelOverride,
} = vi.hoisted(() => ({
  mockNormResponses: vi.fn(),
  mockNormMessages: vi.fn(),
  mockEditResponses: vi.fn(),
  mockEditMessages: vi.fn(),
  mockSetModelOverride: vi.fn(),
}));

vi.mock('../../src/commands/config/normalize-responses.js', () => ({
  normalizeResponsesCommand: mockNormResponses,
}));
vi.mock('../../src/commands/config/normalize-messages.js', () => ({
  normalizeMessagesCommand: mockNormMessages,
}));
vi.mock('../../src/commands/config/override-levers.js', () => ({
  editNormalizeResponses: mockEditResponses,
  editNormalizeMessages: mockEditMessages,
}));

vi.mock('../../src/commands/config/config.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../src/commands/config/config.js')>();
  return { ...actual, setModelOverride: mockSetModelOverride };
});

vi.mock('@clack/prompts', () => ({
  isCancel: (val: unknown) => val === Symbol.for('clack:cancel'),
  note: vi.fn(),
  intro: vi.fn(),
  outro: vi.fn(),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    step: vi.fn(),
  },
  select: vi.fn(),
}));

const { globalFixesMenu, perModelFixesMenu, fixesCommand } = await import(
  '../../src/commands/config/fixes-menu.js'
);

const CANCEL = Symbol.for('clack:cancel');

async function selectSequence(...values: unknown[]): Promise<void> {
  const { select } = await import('@clack/prompts');
  const fn = select as unknown as ReturnType<typeof vi.fn>;
  for (const v of values) fn.mockResolvedValueOnce(v);
}

describe('perModelFixesMenu', () => {
  let tmpDir: string;
  let configPath: string;
  const baseCurrent = { provider: { only: 'anthropic' } };

  beforeEach(() => {
    tmpDir = createTempDir();
    configPath = join(tmpDir, 'proxitor.config.yaml');
    mockEditResponses.mockReset();
    mockEditMessages.mockReset();
    mockSetModelOverride.mockReset();
  });
  afterEach(() => {
    removeTempDir(tmpDir);
    vi.clearAllMocks();
  });

  it('persists and returns the override when a lever changes it', async () => {
    await selectSequence('normalizeResponses', 'back');
    const next = { ...baseCurrent, normalizeResponses: true };
    mockEditResponses.mockResolvedValueOnce(next);

    const result = await perModelFixesMenu({
      modelKey: 'claude-*',
      current: { ...baseCurrent },
      configPath,
    });

    expect(mockSetModelOverride).toHaveBeenCalledWith(configPath, 'claude-*', next);
    expect(result).toEqual(next);
  });

  it('persists via the messages lever too', async () => {
    await selectSequence('normalizeMessages', 'back');
    const next = { ...baseCurrent, normalizeMessages: true };
    mockEditMessages.mockResolvedValueOnce(next);

    const result = await perModelFixesMenu({
      modelKey: 'claude-*',
      current: { ...baseCurrent },
      configPath,
    });

    expect(mockSetModelOverride).toHaveBeenCalledWith(configPath, 'claude-*', next);
    expect(result).toEqual(next);
  });

  it('skips the write when the lever returns an equal override (no-op)', async () => {
    await selectSequence('normalizeResponses', 'back');
    // Lever returns the same shape → overridesEqual is true → no write.
    mockEditResponses.mockResolvedValueOnce({ ...baseCurrent });

    const result = await perModelFixesMenu({
      modelKey: 'claude-*',
      current: { ...baseCurrent },
      configPath,
    });

    expect(mockSetModelOverride).not.toHaveBeenCalled();
    expect(result).toEqual(baseCurrent);
  });

  it('returns current unchanged when the menu is cancelled', async () => {
    await selectSequence(CANCEL);

    const result = await perModelFixesMenu({
      modelKey: 'claude-*',
      current: { ...baseCurrent },
      configPath,
    });

    expect(mockSetModelOverride).not.toHaveBeenCalled();
    expect(result).toEqual(baseCurrent);
  });

  it('returns current when the user picks Back', async () => {
    await selectSequence('back');

    const result = await perModelFixesMenu({
      modelKey: 'claude-*',
      current: { ...baseCurrent },
      configPath,
    });

    expect(mockSetModelOverride).not.toHaveBeenCalled();
    expect(result).toEqual(baseCurrent);
  });
});

describe('globalFixesMenu', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    configPath = join(tmpDir, 'proxitor.config.yaml');
    writeFileSync(configPath, 'normalizeResponses: true\nport: 8828\n');
    mockNormResponses.mockReset();
    mockNormMessages.mockReset();
  });
  afterEach(() => {
    removeTempDir(tmpDir);
    vi.clearAllMocks();
  });

  it('dispatches to the lever command, then exits on Back', async () => {
    await selectSequence('normalizeResponses', 'back');
    mockNormResponses.mockResolvedValueOnce(undefined);

    await globalFixesMenu({ configPath });

    expect(mockNormResponses).toHaveBeenCalledWith({ configPath });
  });

  it('dispatches the messages lever too', async () => {
    await selectSequence('normalizeMessages', 'back');
    mockNormMessages.mockResolvedValueOnce(undefined);

    await globalFixesMenu({ configPath });

    expect(mockNormMessages).toHaveBeenCalledWith({ configPath });
  });

  it('makes no dispatch when cancelled', async () => {
    await selectSequence(CANCEL);

    await globalFixesMenu({ configPath });

    expect(mockNormResponses).not.toHaveBeenCalled();
    expect(mockNormMessages).not.toHaveBeenCalled();
  });
});

describe('fixesCommand', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    configPath = join(tmpDir, 'proxitor.config.yaml');
    writeFileSync(configPath, 'port: 8828\n');
  });
  afterEach(() => {
    removeTempDir(tmpDir);
    vi.clearAllMocks();
  });

  it('wraps the global menu with intro/outro', async () => {
    await selectSequence('back');

    await fixesCommand({ configPath });

    const { intro, outro } = await import('@clack/prompts');
    expect(intro).toHaveBeenCalledWith('Proxitor · Fixes');
    expect(outro).toHaveBeenCalledWith('Bye!');
  });
});
