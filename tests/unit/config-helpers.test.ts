/**
 * Direct coverage for the `modelOverrides` YAML helpers in
 * src/commands/config/config.ts: setModelOverride / removeModelOverride /
 * getModelOverrides. The global setters (setGlobalConfigField(s)) are already
 * covered by config-menu-bugfixes.test.ts (Bug #3).
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getModelOverrides,
  readConfigRaw,
  removeModelOverride,
  setModelOverride,
} from '../../src/commands/config/config.js';
import { createTempDir, removeTempDir } from '../helpers.js';

describe('setModelOverride', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    configPath = join(tmpDir, 'proxitor.config.yaml');
  });
  afterEach(() => removeTempDir(tmpDir));

  it('creates the modelOverrides map when absent', () => {
    writeFileSync(configPath, 'port: 8828\n');

    setModelOverride(configPath, 'claude-*', { provider: { only: 'anthropic' } });

    expect(getModelOverrides(configPath)).toEqual({
      'claude-*': { provider: { only: 'anthropic' } },
    });
  });

  it('adds an entry while preserving existing ones', () => {
    writeFileSync(
      configPath,
      'modelOverrides:\n  claude-*:\n    provider:\n      only: anthropic\nport: 8828\n',
    );

    setModelOverride(configPath, 'gpt-4', { provider: { only: 'openai' } });

    expect(getModelOverrides(configPath)).toEqual({
      'claude-*': { provider: { only: 'anthropic' } },
      'gpt-4': { provider: { only: 'openai' } },
    });
  });
});

describe('removeModelOverride', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    configPath = join(tmpDir, 'proxitor.config.yaml');
  });
  afterEach(() => removeTempDir(tmpDir));

  it('throws when the key is not present', () => {
    writeFileSync(
      configPath,
      'modelOverrides:\n  claude-*:\n    provider:\n      only: anthropic\n',
    );

    expect(() => removeModelOverride(configPath, 'missing')).toThrow(
      /No override found for "missing"/,
    );
  });

  it('removes one entry while leaving the rest', () => {
    writeFileSync(
      configPath,
      'modelOverrides:\n  claude-*:\n    provider:\n      only: anthropic\n  gpt-4:\n    provider:\n      only: openai\n',
    );

    removeModelOverride(configPath, 'claude-*');

    expect(getModelOverrides(configPath)).toEqual({
      'gpt-4': { provider: { only: 'openai' } },
    });
  });

  it('deletes the modelOverrides map when the last entry is removed', () => {
    writeFileSync(
      configPath,
      'modelOverrides:\n  claude-*:\n    provider:\n      only: anthropic\nport: 8828\n',
    );

    removeModelOverride(configPath, 'claude-*');

    expect(getModelOverrides(configPath)).toEqual({});
    // The key itself is gone from the file, not left as an empty map.
    const raw = readConfigRaw(configPath);
    expect(raw).not.toContain('modelOverrides');
    expect(raw).toContain('port: 8828');
  });
});

describe('getModelOverrides', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    configPath = join(tmpDir, 'proxitor.config.yaml');
  });
  afterEach(() => removeTempDir(tmpDir));

  it('returns an empty object when modelOverrides is absent', () => {
    writeFileSync(configPath, 'port: 8828\n');
    expect(getModelOverrides(configPath)).toEqual({});
  });

  it('returns parsed entries via the YAMLMap toJSON branch', () => {
    writeFileSync(configPath, 'modelOverrides:\n  claude-*:\n    cacheControl: always\n');

    expect(getModelOverrides(configPath)).toEqual({
      'claude-*': { cacheControl: 'always' },
    });
  });
});
