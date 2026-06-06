import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/index.js';
import { createTempDir, removeTempDir } from '../helpers.js';

describe('Config Loading', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      removeTempDir(dir);
    }
    dirs.length = 0;
  });

  function tempDir(): string {
    const dir = createTempDir();
    dirs.push(dir);
    return dir;
  }

  it('loads provider config from YAML file', async () => {
    const dir = tempDir();
    const configPath = join(dir, 'proxitor.config.yaml');
    writeFileSync(
      configPath,
      ['provider:', '  only: deepinfra', '  allowFallbacks: false', 'port: 9090'].join(
        '\n',
      ),
    );

    const config = await loadConfig({ configPath, openrouterKey: 'test-key' });
    expect(config.provider?.only).toBe('deepinfra');
    expect(config.provider?.allowFallbacks).toBe(false);
    expect(config.port).toBe(9090);
  });

  it('loads provider config from JSON file', async () => {
    const dir = tempDir();
    const configPath = join(dir, 'proxitor.config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        provider: { order: ['anthropic', 'openai'] },
        modelOverrides: { 'claude-*': { provider: { only: 'anthropic' } } },
      }),
    );

    const config = await loadConfig({ configPath, openrouterKey: 'test-key' });
    expect(config.provider?.order).toEqual(['anthropic', 'openai']);
    expect(config.modelOverrides).toHaveProperty('claude-*');
  });

  it('throws on missing explicit config path', async () => {
    await expect(
      loadConfig({ configPath: '/nonexistent/config.yaml', openrouterKey: 'test-key' }),
    ).rejects.toThrow('Config file not found');
  });

  it('prioritizes CLI options over file config', async () => {
    const dir = tempDir();
    const configPath = join(dir, 'proxitor.config.yaml');
    writeFileSync(configPath, ['port: 9090', 'host: 0.0.0.0'].join('\n'));

    const config = await loadConfig({
      configPath,
      openrouterKey: 'test-key',
      port: 3000,
      verbose: true,
    });
    // CLI overrides file
    expect(config.port).toBe(3000);
    expect(config.verbose).toBe(true);
  });

  it('loads model overrides with headers from YAML', async () => {
    const dir = tempDir();
    const configPath = join(dir, 'proxitor.config.yaml');
    writeFileSync(
      configPath,
      [
        'provider:',
        '  only: openai',
        'modelOverrides:',
        '  "gpt-*":',
        '    provider:',
        '      only: deepinfra',
        '    headers:',
        '      X-Model-Family: gpt',
      ].join('\n'),
    );

    const config = await loadConfig({ configPath, openrouterKey: 'test-key' });
    expect(config.modelOverrides?.['gpt-*']?.provider?.only).toBe('deepinfra');
    expect(config.modelOverrides?.['gpt-*']?.headers).toEqual({
      'X-Model-Family': 'gpt',
    });
  });
});
