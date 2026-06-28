/**
 * Coverage for `removeOverrideCommand` (src/commands/config/remove.ts).
 *
 * Mocks only the clack prompts (multiselect/confirm); the modelOverrides
 * helpers run for real against a temp config, so this also exercises the real
 * removeModelOverride write path.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTempDir, removeTempDir } from '../helpers.js';

const { mockMultiselect, mockConfirm } = vi.hoisted(() => ({
  mockMultiselect: vi.fn(),
  mockConfirm: vi.fn(),
}));

vi.mock('@clack/prompts', () => ({
  isCancel: (val: unknown) => val === Symbol.for('clack:cancel'),
  intro: vi.fn(),
  outro: vi.fn(),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    step: vi.fn(),
  },
  multiselect: mockMultiselect,
  confirm: mockConfirm,
}));

const { removeOverrideCommand } = await import('../../src/commands/config/remove.js');
const { getModelOverrides, readConfigRaw } = await import(
  '../../src/commands/config/config.js'
);

const CANCEL = Symbol.for('clack:cancel');

const TWO_OVERRIDES =
  'modelOverrides:\n  claude-*:\n    provider:\n      only: anthropic\n  gpt-4:\n    provider:\n      only: openai\nport: 8828\n';
const ONE_OVERRIDE =
  'modelOverrides:\n  claude-*:\n    provider:\n      only: anthropic\nport: 8828\n';

describe('removeOverrideCommand', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    configPath = join(tmpDir, 'proxitor.config.yaml');
    mockMultiselect.mockReset();
    mockConfirm.mockReset();
  });
  afterEach(() => {
    removeTempDir(tmpDir);
    vi.clearAllMocks();
  });

  it('warns and exits early when there are no overrides', async () => {
    writeFileSync(configPath, 'port: 8828\n');

    await removeOverrideCommand({ configPath });

    expect(mockMultiselect).not.toHaveBeenCalled();
    const { log } = await import('@clack/prompts');
    expect(log.warn).toHaveBeenCalledWith('No model overrides found.');
  });

  it('makes no change when the multiselect is cancelled', async () => {
    writeFileSync(configPath, TWO_OVERRIDES);
    mockMultiselect.mockResolvedValueOnce(CANCEL);

    await removeOverrideCommand({ configPath });

    expect(getModelOverrides(configPath)).toEqual({
      'claude-*': { provider: { only: 'anthropic' } },
      'gpt-4': { provider: { only: 'openai' } },
    });
  });

  it('makes no change when the confirm is cancelled', async () => {
    writeFileSync(configPath, TWO_OVERRIDES);
    mockMultiselect.mockResolvedValueOnce(['claude-*']);
    mockConfirm.mockResolvedValueOnce(CANCEL);

    await removeOverrideCommand({ configPath });

    expect(getModelOverrides(configPath)).toHaveProperty('claude-*');
  });

  it('makes no change when the confirm is declined', async () => {
    writeFileSync(configPath, TWO_OVERRIDES);
    mockMultiselect.mockResolvedValueOnce(['claude-*']);
    mockConfirm.mockResolvedValueOnce(false);

    await removeOverrideCommand({ configPath });

    expect(getModelOverrides(configPath)).toHaveProperty('claude-*');
  });

  it('removes all selected overrides and confirms the count', async () => {
    writeFileSync(configPath, TWO_OVERRIDES);
    mockMultiselect.mockResolvedValueOnce(['claude-*', 'gpt-4']);
    mockConfirm.mockResolvedValueOnce(true);

    await removeOverrideCommand({ configPath });

    expect(getModelOverrides(configPath)).toEqual({});
    const { outro } = await import('@clack/prompts');
    expect(outro).toHaveBeenCalledWith('✓ 2 override(s) removed');
  });

  it('drops the modelOverrides map when the last override is removed', async () => {
    writeFileSync(configPath, ONE_OVERRIDE);
    mockMultiselect.mockResolvedValueOnce(['claude-*']);
    mockConfirm.mockResolvedValueOnce(true);

    await removeOverrideCommand({ configPath });

    const raw = readConfigRaw(configPath);
    expect(raw).not.toContain('modelOverrides');
    expect(raw).toContain('port: 8828');
  });
});
