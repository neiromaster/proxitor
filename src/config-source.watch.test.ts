import { mkdtempSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig, type ProxyConfig } from './config.js';
import { createConfigSource } from './config-source.js';
import { logger } from './logger.js';

// Force an mtime bump — watchFile polling can miss same-tick edits on coarse-mtime filesystems.
function touchFuture(path: string, addSeconds: number): void {
  const when = Date.now() / 1000 + addSeconds;
  utimesSync(path, when, when);
}

describe('FileWatchingConfigSource file watching', () => {
  it('reloads when the config file changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'config-source-watch-'));
    const configPath = join(dir, 'config.yaml');
    const original = [
      'openrouterKey: test-key',
      'openrouterBaseUrl: https://example.com',
      'cacheControl: auto',
    ].join('\n');
    writeFileSync(configPath, original);

    const initial = await loadConfig({ configPath });
    const source = createConfigSource({
      loadOptions: { configPath },
      initial,
      pollIntervalMs: 50,
    });
    source.start();

    try {
      writeFileSync(
        configPath,
        original.replace('cacheControl: auto', 'cacheControl: always'),
      );
      touchFuture(configPath, 2);

      await vi.waitFor(() => expect(source.get().cacheControl).toBe('always'), {
        timeout: 2000,
        interval: 30,
      });
    } finally {
      source.stop();
    }
  });

  it('keeps the current config and warns when the file disappears, then reloads on recreate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'config-source-watch-'));
    const configPath = join(dir, 'config.yaml');
    const original = [
      'openrouterKey: test-key',
      'openrouterBaseUrl: https://example.com',
      'cacheControl: always',
    ].join('\n');
    writeFileSync(configPath, original);

    const initial = (await loadConfig({ configPath })) as ProxyConfig;
    const source = createConfigSource({
      loadOptions: { configPath },
      initial,
      pollIntervalMs: 50,
    });
    source.start();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    try {
      unlinkSync(configPath);
      await vi.waitFor(
        () => expect(warn).toHaveBeenCalledWith(expect.stringContaining('disappeared')),
        { timeout: 2000, interval: 30 },
      );
      expect(source.get().cacheControl).toBe('always'); // unchanged

      writeFileSync(
        configPath,
        original.replace('cacheControl: always', 'cacheControl: skip'),
      );
      touchFuture(configPath, 4);
      await vi.waitFor(() => expect(source.get().cacheControl).toBe('skip'), {
        timeout: 2000,
        interval: 30,
      });
    } finally {
      warn.mockRestore();
      source.stop();
    }
  });
});
