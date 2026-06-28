/**
 * Coverage for `normalizeResponsesCommand` (src/commands/config/normalize-responses.ts).
 *
 * Mirrors the normalizeMessagesCommand tests: mock the prompt helper + clack.log,
 * drive the command with a real temp config, and assert what gets written.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTempDir, removeTempDir } from '../helpers.js';

const { mockAskNr } = vi.hoisted(() => ({
  mockAskNr: vi.fn(),
}));

vi.mock('../../src/commands/config/prompts.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../src/commands/config/prompts.js')>();
  return { ...actual, askNormalizeResponses: mockAskNr };
});

vi.mock('@clack/prompts', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    step: vi.fn(),
  },
}));

const { normalizeResponsesCommand } = await import(
  '../../src/commands/config/normalize-responses.js'
);
const { readConfigRaw } = await import('../../src/commands/config/config.js');

describe('normalizeResponsesCommand (global)', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    configPath = join(tmpDir, 'proxitor.config.yaml');
    mockAskNr.mockClear();
  });
  afterEach(() => {
    removeTempDir(tmpDir);
    vi.clearAllMocks();
  });

  it('passes undefined current (→ Reset/inherit highlighted) when normalizeResponses absent', async () => {
    writeFileSync(configPath, 'port: 8828\n');
    mockAskNr.mockResolvedValueOnce(Symbol.for('clack:cancel'));

    await normalizeResponsesCommand({ configPath });

    expect(mockAskNr).toHaveBeenCalledTimes(1);
    expect(mockAskNr).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      expect.objectContaining({ removable: true }),
    );
  });

  it('passes the explicit value when normalizeResponses is set in config', async () => {
    writeFileSync(configPath, 'normalizeResponses: false\nport: 8828\n');
    mockAskNr.mockResolvedValueOnce(Symbol.for('clack:cancel'));

    await normalizeResponsesCommand({ configPath });

    expect(mockAskNr).toHaveBeenCalledTimes(1);
    expect(mockAskNr).toHaveBeenCalledWith(
      expect.any(String),
      false,
      expect.objectContaining({ removable: true }),
    );
  });

  it('writes the chosen value when the user picks On', async () => {
    writeFileSync(configPath, 'port: 8828\n');
    mockAskNr.mockResolvedValueOnce(true);

    await normalizeResponsesCommand({ configPath });

    const raw = readConfigRaw(configPath);
    expect(raw).toContain('normalizeResponses: true');
  });

  it('removes normalizeResponses on reset', async () => {
    writeFileSync(configPath, 'normalizeResponses: false\nport: 8828\n');
    mockAskNr.mockResolvedValueOnce('reset');

    await normalizeResponsesCommand({ configPath });

    const raw = readConfigRaw(configPath);
    expect(raw).not.toContain('normalizeResponses');
  });

  it('makes no change when cancelled', async () => {
    writeFileSync(configPath, 'normalizeResponses: false\nport: 8828\n');
    mockAskNr.mockResolvedValueOnce(Symbol.for('clack:cancel'));

    await normalizeResponsesCommand({ configPath });

    const raw = readConfigRaw(configPath);
    expect(raw).toContain('normalizeResponses: false');
  });
});
