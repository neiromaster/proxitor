import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createConfigFile, defaultWritePath } from './config-file.js';

const FILE = (path: string): string => `# config at ${path}\nversion: 1\n`;

describe('createConfigFile', () => {
  test('explicit path: reads it; missing path: ConfigError naming it', async () => {
    const files = createConfigFile({
      readFile: async p =>
        p === '/tmp/proxitor.yaml' ? FILE(p) : Promise.reject(new Error('ENOENT')),
    });
    const found = await files.findAndRead('/tmp/proxitor.yaml');
    expect(found.path).toBe('/tmp/proxitor.yaml');
    expect(found.text).toContain('version: 1');
    await expect(files.findAndRead('/tmp/missing.yaml')).rejects.toThrow(
      /\/tmp\/missing\.yaml/,
    );
  });

  test('search order: home names first, then XDG dir (XDG_CONFIG_HOME honored)', async () => {
    const readAttempts: string[] = [];
    const files = createConfigFile({
      env: { XDG_CONFIG_HOME: '/xdg' },
      readFile: async p => {
        readAttempts.push(p);
        return p === '/xdg/proxitor/config.yml'
          ? FILE(p)
          : Promise.reject(new Error('ENOENT'));
      },
    });
    const found = await files.findAndRead();
    expect(found.path).toBe('/xdg/proxitor/config.yml');
    expect(readAttempts[0]).toMatch(/proxitor\.config\.yaml$/);
    expect(readAttempts).toContain('/xdg/proxitor/config.yaml');
  });

  test('no candidate found: ConfigError lists searched locations', async () => {
    const files = createConfigFile({
      env: { XDG_CONFIG_HOME: '/xdg' },
      readFile: async () => Promise.reject(new Error('ENOENT')),
    });
    await expect(files.findAndRead()).rejects.toThrow(/no config found/);
  });

  test('parse: YAML text → unknown; broken text → ConfigError with path', () => {
    const files = createConfigFile();
    expect(files.parse('version: 1\nproviders: {}\n', 'a.yaml')).toEqual({
      version: 1,
      providers: {},
    });
    expect(() => files.parse('{ broken', 'a.json')).toThrow(/a\.json/);
  });

  describe('defaultWritePath', () => {
    test('prefers XDG_CONFIG_HOME', () => {
      expect(defaultWritePath({ XDG_CONFIG_HOME: '/xdg' })).toBe(
        '/xdg/proxitor/config.yaml',
      );
    });

    test('falls back to ~/.config/proxitor without XDG', () => {
      expect(defaultWritePath({})).toBe(
        join(homedir(), '.config', 'proxitor', 'config.yaml'),
      );
    });
  });
});
