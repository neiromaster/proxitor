import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelOverride } from '../../src/config-schema.js';
import { createTempDir, removeTempDir } from '../helpers.js';

const { mockCacheControlCommand, mockSessionCommand, mockNormalizeCommand } = vi.hoisted(
  () => ({
    mockCacheControlCommand: vi.fn(async () => {}),
    mockSessionCommand: vi.fn(async () => {}),
    mockNormalizeCommand: vi.fn(async () => {}),
  }),
);

const { mockEditCacheControl, mockEditSessionId, mockEditNvs } = vi.hoisted(() => ({
  mockEditCacheControl: vi.fn(),
  mockEditSessionId: vi.fn(),
  mockEditNvs: vi.fn(),
}));

const { mockRequireConfigPath, mockSetModelOverride } = vi.hoisted(() => ({
  mockRequireConfigPath: vi.fn(),
  mockSetModelOverride: vi.fn(),
}));

vi.mock('../../src/commands/config/cache-control.js', () => ({
  cacheControlCommand: mockCacheControlCommand,
}));
vi.mock('../../src/commands/config/session-routing.js', () => ({
  sessionRoutingCommand: mockSessionCommand,
}));
vi.mock('../../src/commands/config/normalize-system.js', () => ({
  normalizeVolatileSystemCommand: mockNormalizeCommand,
}));
vi.mock('../../src/commands/config/override-levers.js', () => ({
  editCacheControl: mockEditCacheControl,
  editSessionId: mockEditSessionId,
  editNormalizeVolatileSystem: mockEditNvs,
}));
vi.mock('../../src/commands/config/config.js', () => ({
  requireConfigPath: mockRequireConfigPath,
  setModelOverride: mockSetModelOverride,
}));
vi.mock('@clack/prompts', () => ({
  isCancel: (v: unknown) => v === Symbol.for('clack:cancel'),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), step: vi.fn() },
  note: vi.fn(),
  intro: vi.fn(),
  outro: vi.fn(),
  select: vi.fn(),
}));

const { globalCachingMenu, perModelCachingMenu, cachingCommand } = await import(
  '../../src/commands/config/caching-menu.js'
);
const {
  select: mockSelect,
  intro: mockIntro,
  outro: mockOutro,
} = await import('@clack/prompts');

const select = mockSelect as ReturnType<typeof vi.fn>;

describe('globalCachingMenu', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    configPath = join(tmpDir, 'proxitor.config.yaml');
    writeFileSync(configPath, 'port: 8828\n');
    mockRequireConfigPath.mockReturnValue(configPath);
  });
  afterEach(() => {
    removeTempDir(tmpDir);
    vi.clearAllMocks();
  });

  it('dispatches the cache lever to cacheControlCommand then exits on Back', async () => {
    select.mockResolvedValueOnce('cacheControl').mockResolvedValueOnce('back');
    await globalCachingMenu({ configPath });
    expect(mockCacheControlCommand).toHaveBeenCalledWith({ configPath });
  });

  it('dispatches sessionId and normalizeVolatileSystem levers', async () => {
    select
      .mockResolvedValueOnce('sessionId')
      .mockResolvedValueOnce('normalizeVolatileSystem')
      .mockResolvedValueOnce('back');
    await globalCachingMenu({ configPath });
    expect(mockSessionCommand).toHaveBeenCalledWith({ configPath });
    expect(mockNormalizeCommand).toHaveBeenCalledWith({ configPath });
  });

  it('exits immediately on cancel without dispatching', async () => {
    select.mockResolvedValueOnce(Symbol.for('clack:cancel'));
    await globalCachingMenu({ configPath });
    expect(mockCacheControlCommand).not.toHaveBeenCalled();
  });
});

describe('perModelCachingMenu', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    configPath = join(tmpDir, 'proxitor.config.yaml');
    writeFileSync(configPath, 'port: 8828\n');
    mockRequireConfigPath.mockReturnValue(configPath);
  });
  afterEach(() => {
    removeTempDir(tmpDir);
    vi.clearAllMocks();
  });

  it('persists each changed lever immediately and returns the latest override', async () => {
    const start = { provider: { only: 'anthropic' } };
    const afterCache = { provider: { only: 'anthropic' }, cacheControl: 'always' };
    mockEditCacheControl.mockResolvedValueOnce(afterCache);
    select.mockResolvedValueOnce('cacheControl').mockResolvedValueOnce('back');

    const result = await perModelCachingMenu({
      modelKey: 'claude-*',
      current: start,
      configPath,
    });

    expect(mockEditCacheControl).toHaveBeenCalledWith(start, configPath);
    expect(mockSetModelOverride).toHaveBeenCalledWith(configPath, 'claude-*', afterCache);
    expect(result).toBe(afterCache);
  });

  it('does NOT write when a lever edit returns the same reference (cancelled inside)', async () => {
    const start: ModelOverride = { cacheControl: 'always' };
    mockEditCacheControl.mockResolvedValueOnce(start);
    select.mockResolvedValueOnce('cacheControl').mockResolvedValueOnce('back');

    await perModelCachingMenu({ modelKey: 'm', current: start, configPath });

    expect(mockSetModelOverride).not.toHaveBeenCalled();
  });

  it('does NOT write on a no-op reselect (new ref, structurally equal data)', async () => {
    const start: ModelOverride = { cacheControl: 'always', sessionId: 'auto' };
    // New reference, identical values — simulates the user re-confirming the same choice.
    mockEditCacheControl.mockResolvedValueOnce({
      cacheControl: 'always',
      sessionId: 'auto',
    });
    select.mockResolvedValueOnce('cacheControl').mockResolvedValueOnce('back');

    await perModelCachingMenu({ modelKey: 'm', current: start, configPath });

    expect(mockSetModelOverride).not.toHaveBeenCalled();
  });

  it('writes once per changed lever across multiple edits', async () => {
    const a = { cacheControl: 'always' };
    const b = { cacheControl: 'always', sessionId: 'always' };
    mockEditCacheControl.mockResolvedValueOnce(a);
    mockEditSessionId.mockResolvedValueOnce(b);
    select
      .mockResolvedValueOnce('cacheControl')
      .mockResolvedValueOnce('sessionId')
      .mockResolvedValueOnce('back');

    await perModelCachingMenu({ modelKey: 'm', current: {}, configPath });

    expect(mockSetModelOverride).toHaveBeenCalledTimes(2);
  });
});

describe('cachingCommand (CLI wrapper)', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    configPath = join(tmpDir, 'proxitor.config.yaml');
    writeFileSync(configPath, 'port: 8828\n');
    mockRequireConfigPath.mockReturnValue(configPath);
  });
  afterEach(() => {
    removeTempDir(tmpDir);
    vi.clearAllMocks();
  });

  it('wraps the menu with intro and outro', async () => {
    select.mockResolvedValueOnce('back');
    await cachingCommand({ configPath });
    expect(mockIntro).toHaveBeenCalled();
    expect(mockOutro).toHaveBeenCalled();
  });
});
