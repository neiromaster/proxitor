import { mkdtempSync, type Stats, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULTS, type ProxyConfig } from './config.js';
import { createConfigSource } from './config-source.js';
import { logger } from './logger.js';

const initial: ProxyConfig = { ...DEFAULTS };

const stat = (mtimeMs: number, nlink = 1): Stats =>
  ({ mtimeMs, nlink }) as unknown as Stats;

// tryFindConfigFile needs an existing path so start() proceeds to watch;
// load is injected, so the file's contents don't matter.
function tempConfigPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'config-source-watch-'));
  const path = join(dir, 'config.yaml');
  writeFileSync(path, 'openrouterKey: test-key\n');
  return path;
}

function fakeWatcher() {
  let onChange: ((curr: Stats, prev: Stats) => void) | undefined;
  const stop = vi.fn();
  const watch = vi.fn(
    (
      _filename: string,
      _pollIntervalMs: number,
      cb: (curr: Stats, prev: Stats) => void,
    ) => {
      onChange = cb;
      return stop;
    },
  );
  return {
    watch,
    stop,
    fire: (curr: Stats, prev: Stats) => onChange?.(curr, prev),
  };
}

describe('FileWatchingConfigSource file watching', () => {
  it('reloads when the watcher signals a content change', async () => {
    const { watch, fire } = fakeWatcher();
    const load = vi.fn(async () => ({ ...initial, cacheControl: 'always' as const }));
    const source = createConfigSource({
      loadOptions: { configPath: tempConfigPath() },
      initial,
      load,
      watch,
    });
    source.start();
    expect(watch).toHaveBeenCalledTimes(1);

    fire(stat(2), stat(1)); // mtime changed → reload

    await vi.waitFor(() => expect(source.get().cacheControl).toBe('always'));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('skips reload on identical mtime and warns on deletion, keeping the config', async () => {
    const { watch, fire } = fakeWatcher();
    const load = vi.fn(async () => ({ ...initial, cacheControl: 'skip' as const }));
    const source = createConfigSource({
      loadOptions: { configPath: tempConfigPath() },
      initial,
      load,
      watch,
    });
    source.start();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    fire(stat(1), stat(1)); // identical mtime → skip
    expect(load).not.toHaveBeenCalled();

    fire(stat(0, 0), stat(1)); // file deleted
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('disappeared'));
    expect(source.get().cacheControl).toBe('auto'); // unchanged
    expect(load).not.toHaveBeenCalled();

    warn.mockRestore();
  });

  it('stops the watcher on stop()', () => {
    const { watch, stop } = fakeWatcher();
    const source = createConfigSource({
      loadOptions: { configPath: tempConfigPath() },
      initial,
      watch,
    });
    source.start();
    source.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
