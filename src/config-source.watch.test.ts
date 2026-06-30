import { mkdtempSync, type Stats, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULTS, type ProxyConfig } from './config.js';
import { createConfigSource, staticConfigSource } from './config-source.js';
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
    expect(source.get().cacheControl).toBeUndefined(); // unchanged
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

  it('notifies subscribers after a reload, and unsubscribe stops them', async () => {
    const { watch, fire } = fakeWatcher();
    const load = vi.fn(
      async (): Promise<ProxyConfig> => ({ ...initial, cacheControl: 'always' }),
    );
    const source = createConfigSource({
      loadOptions: { configPath: tempConfigPath() },
      initial,
      load,
      watch,
    });
    const listener = vi.fn();
    const unsubscribe = source.subscribe(listener);

    source.start();
    fire(stat(2), stat(1)); // mtime changed → reload → notify

    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ cacheControl: 'always' }),
    );

    unsubscribe();
    load.mockResolvedValueOnce({ ...initial, cacheControl: 'skip' as const });
    fire(stat(3), stat(2));
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(listener).toHaveBeenCalledTimes(1); // not called again after unsubscribe
  });

  it('staticConfigSource subscribe is a no-op', () => {
    const source = staticConfigSource(initial);
    const unsubscribe = source.subscribe(() => {
      throw new Error('must not be called');
    });
    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
  });
});
