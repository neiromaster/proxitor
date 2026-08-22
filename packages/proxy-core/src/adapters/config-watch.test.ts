import type { Stats } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import type { ReloadResult } from '../application/hot-reload.js';
import { createConfigWatcher } from './config-watch.js';

// Test fakes
const silent = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

describe('createConfigWatcher', () => {
  test('mtime change → reload called', () => {
    // Arrange
    const reloadSpy = vi.fn<() => Promise<ReloadResult>>(() =>
      Promise.resolve({ ok: true, changes: 'test' }),
    );
    const logger = { ...silent, info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const watchCalls: Array<{
      filename: string;
      pollIntervalMs: number;
      onChange: (curr: Stats, prev: Stats) => void;
    }> = [];
    const stopSpy = vi.fn<() => void>();
    const watch = vi.fn(
      (
        filename: string,
        pollIntervalMs: number,
        onChange: (curr: Stats, prev: Stats) => void,
      ) => {
        watchCalls.push({ filename, pollIntervalMs, onChange });
        return stopSpy;
      },
    );

    const prevStats: Stats = {
      isFile: () => true,
      isDirectory: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
      isSymbolicLink: () => false,
      dev: 1,
      ino: 1,
      mode: 0o644,
      nlink: 1,
      uid: 1000,
      gid: 1000,
      rdev: 0,
      size: 100,
      blksize: 4096,
      blocks: 8,
      atimeMs: 1000,
      mtimeMs: 2000,
      ctimeMs: 3000,
      birthtimeMs: 4000,
      atime: new Date(1000),
      mtime: new Date(2000),
      ctime: new Date(3000),
      birthtime: new Date(4000),
      atimeInstant: new Date(1000).toISOString(),
      mtimeInstant: new Date(2000).toISOString(),
      ctimeInstant: new Date(3000).toISOString(),
      birthtimeInstant: new Date(4000).toISOString(),
    };

    const currStats: Stats = {
      ...prevStats,
      mtimeMs: 5000,
      mtime: new Date(5000),
    };

    const watcher = createConfigWatcher({
      path: '/test/config.yaml',
      reload: reloadSpy,
      logger,
      pollIntervalMs: 100,
      watch,
    });

    // Act - start the watcher
    watcher.start();

    // Simulate mtime change
    expect(watchCalls).toHaveLength(1);
    const onChangeCallback = watchCalls[0]!.onChange;
    onChangeCallback(currStats, prevStats);

    // Wait for async reload
    // NOTE: In tests, we need to wait a tick for the promise to be scheduled

    // Assert
    expect(watch).toHaveBeenCalledWith('/test/config.yaml', 100, expect.any(Function));
  });

  test('same mtime → reload not called', () => {
    // Arrange
    const reloadSpy = vi.fn<() => Promise<ReloadResult>>(() =>
      Promise.resolve({ ok: true, changes: 'test' }),
    );
    const logger = { ...silent, info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const watchCalls: Array<{
      filename: string;
      pollIntervalMs: number;
      onChange: (curr: Stats, prev: Stats) => void;
    }> = [];
    const watch = vi.fn(
      (
        filename: string,
        pollIntervalMs: number,
        onChange: (curr: Stats, prev: Stats) => void,
      ) => {
        watchCalls.push({ filename, pollIntervalMs, onChange });
        return vi.fn();
      },
    );

    const stats: Stats = {
      isFile: () => true,
      isDirectory: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
      isSymbolicLink: () => false,
      dev: 1,
      ino: 1,
      mode: 0o644,
      nlink: 1,
      uid: 1000,
      gid: 1000,
      rdev: 0,
      size: 100,
      blksize: 4096,
      blocks: 8,
      atimeMs: 1000,
      mtimeMs: 2000,
      ctimeMs: 3000,
      birthtimeMs: 4000,
      atime: new Date(1000),
      mtime: new Date(2000),
      ctime: new Date(3000),
      birthtime: new Date(4000),
      atimeInstant: new Date(1000).toISOString(),
      mtimeInstant: new Date(2000).toISOString(),
      ctimeInstant: new Date(3000).toISOString(),
      birthtimeInstant: new Date(4000).toISOString(),
    };

    const watcher = createConfigWatcher({
      path: '/test/config.yaml',
      reload: reloadSpy,
      logger,
      pollIntervalMs: 100,
      watch,
    });

    // Act - start the watcher
    watcher.start();

    // Simulate same mtime
    expect(watchCalls).toHaveLength(1);
    const onChangeCallback = watchCalls[0]!.onChange;
    onChangeCallback(stats, stats);

    // Assert - reload should not be called when mtime unchanged
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  test('nlink: 0 → warn logged, no reload', () => {
    // Arrange
    const reloadSpy = vi.fn<() => Promise<ReloadResult>>(() =>
      Promise.resolve({ ok: true, changes: 'test' }),
    );
    const logger = { ...silent, warn: vi.fn() };
    const watchCalls: Array<{
      filename: string;
      pollIntervalMs: number;
      onChange: (curr: Stats, prev: Stats) => void;
    }> = [];
    const watch = vi.fn(
      (
        filename: string,
        pollIntervalMs: number,
        onChange: (curr: Stats, prev: Stats) => void,
      ) => {
        watchCalls.push({ filename, pollIntervalMs, onChange });
        return vi.fn();
      },
    );

    const prevStats: Stats = {
      isFile: () => true,
      isDirectory: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
      isSymbolicLink: () => false,
      dev: 1,
      ino: 1,
      mode: 0o644,
      nlink: 1,
      uid: 1000,
      gid: 1000,
      rdev: 0,
      size: 100,
      blksize: 4096,
      blocks: 8,
      atimeMs: 1000,
      mtimeMs: 2000,
      ctimeMs: 3000,
      birthtimeMs: 4000,
      atime: new Date(1000),
      mtime: new Date(2000),
      ctime: new Date(3000),
      birthtime: new Date(4000),
      atimeInstant: new Date(1000).toISOString(),
      mtimeInstant: new Date(2000).toISOString(),
      ctimeInstant: new Date(3000).toISOString(),
      birthtimeInstant: new Date(4000).toISOString(),
    };

    const currStats: Stats = {
      ...prevStats,
      nlink: 0,
    };

    const watcher = createConfigWatcher({
      path: '/test/config.yaml',
      reload: reloadSpy,
      logger,
      pollIntervalMs: 100,
      watch,
    });

    // Act - start the watcher
    watcher.start();

    // Simulate file disappeared (nlink: 0)
    expect(watchCalls).toHaveLength(1);
    const onChangeCallback = watchCalls[0]!.onChange;
    onChangeCallback(currStats, prevStats);

    // Assert
    expect(logger.warn).toHaveBeenCalledWith(
      'config file disappeared — keeping current config (/test/config.yaml)',
    );
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  test('start/stop idempotent', () => {
    // Arrange
    const reloadSpy = vi.fn<() => Promise<ReloadResult>>(() =>
      Promise.resolve({ ok: true, changes: 'test' }),
    );
    const logger = silent;
    const stopSpy = vi.fn<() => void>();
    const watch = vi.fn(() => stopSpy);

    const watcher = createConfigWatcher({
      path: '/test/config.yaml',
      reload: reloadSpy,
      logger,
      pollIntervalMs: 100,
      watch,
    });

    // Act - multiple starts should only call watch once
    watcher.start();
    watcher.start();
    watcher.start();

    // Assert
    expect(watch).toHaveBeenCalledTimes(1);

    // Act - multiple stops should only call stop once
    watcher.stop();
    watcher.stop();
    watcher.stop();

    // Assert
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  test('null path → start logs and no watch call', () => {
    // Arrange
    const reloadSpy = vi.fn<() => Promise<ReloadResult>>(() =>
      Promise.resolve({ ok: true, changes: 'test' }),
    );
    const logger = { ...silent, info: vi.fn() };
    const watch = vi.fn();

    const watcher = createConfigWatcher({
      path: null,
      reload: reloadSpy,
      logger,
      pollIntervalMs: 100,
      watch,
    });

    // Act
    watcher.start();

    // Assert
    expect(logger.info).toHaveBeenCalledWith(
      'live config reload disabled (no config file)',
    );
    expect(watch).not.toHaveBeenCalled();
  });

  test('reload rejection is swallowed (no unhandled rejection)', async () => {
    // Arrange
    const reloadSpy = vi.fn<() => Promise<ReloadResult>>(() =>
      Promise.reject(new Error('reload failed')),
    );
    const logger = { ...silent, error: vi.fn() };
    const watchCalls: Array<{
      filename: string;
      pollIntervalMs: number;
      onChange: (curr: Stats, prev: Stats) => void;
    }> = [];
    const watch = vi.fn(
      (
        filename: string,
        pollIntervalMs: number,
        onChange: (curr: Stats, prev: Stats) => void,
      ) => {
        watchCalls.push({ filename, pollIntervalMs, onChange });
        return vi.fn();
      },
    );

    const prevStats: Stats = {
      isFile: () => true,
      isDirectory: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
      isSymbolicLink: () => false,
      dev: 1,
      ino: 1,
      mode: 0o644,
      nlink: 1,
      uid: 1000,
      gid: 1000,
      rdev: 0,
      size: 100,
      blksize: 4096,
      blocks: 8,
      atimeMs: 1000,
      mtimeMs: 2000,
      ctimeMs: 3000,
      birthtimeMs: 4000,
      atime: new Date(1000),
      mtime: new Date(2000),
      ctime: new Date(3000),
      birthtime: new Date(4000),
      atimeInstant: new Date(1000).toISOString(),
      mtimeInstant: new Date(2000).toISOString(),
      ctimeInstant: new Date(3000).toISOString(),
      birthtimeInstant: new Date(4000).toISOString(),
    };

    const currStats: Stats = {
      ...prevStats,
      mtimeMs: 5000,
      mtime: new Date(5000),
    };

    const watcher = createConfigWatcher({
      path: '/test/config.yaml',
      reload: reloadSpy,
      logger,
      pollIntervalMs: 100,
      watch,
    });

    // Act
    watcher.start();
    expect(watchCalls).toHaveLength(1);
    const onChangeCallback = watchCalls[0]!.onChange;

    // This should not throw even though reload rejects
    onChangeCallback(currStats, prevStats);

    // Wait a tick to ensure the async reload has completed
    await new Promise(resolve => setTimeout(resolve, 0));

    // Assert - error should be logged, no unhandled rejection
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('reload failed'),
      expect.any(Object),
    );
  });

  test('start → stop → start re-watches correctly', () => {
    // Arrange
    const reloadSpy = vi.fn<() => Promise<ReloadResult>>(() =>
      Promise.resolve({ ok: true, changes: 'test' }),
    );
    const logger = silent;
    const watchCalls: Array<{
      filename: string;
      pollIntervalMs: number;
      onChange: (curr: Stats, prev: Stats) => void;
    }> = [];
    const stopSpy1 = vi.fn<() => void>();
    const stopSpy2 = vi.fn<() => void>();
    let callCount = 0;
    const watch = vi.fn(
      (
        filename: string,
        pollIntervalMs: number,
        onChange: (curr: Stats, prev: Stats) => void,
      ) => {
        watchCalls.push({ filename, pollIntervalMs, onChange });
        // Return different stop spies for different calls
        callCount++;
        return callCount === 1 ? stopSpy1 : stopSpy2;
      },
    );

    const watcher = createConfigWatcher({
      path: '/test/config.yaml',
      reload: reloadSpy,
      logger,
      pollIntervalMs: 100,
      watch,
    });

    // Act - start → stop → start
    watcher.start();
    expect(watchCalls).toHaveLength(1);
    expect(watch).toHaveBeenCalledWith('/test/config.yaml', 100, expect.any(Function));

    watcher.stop();
    expect(stopSpy1).toHaveBeenCalled();

    watcher.start();
    expect(watchCalls).toHaveLength(2);
    expect(watch).toHaveBeenCalledTimes(2);

    watcher.stop();
    expect(stopSpy2).toHaveBeenCalled();

    // Assert - first stop spy called once, second stop spy called once
    expect(stopSpy1).toHaveBeenCalledTimes(1);
    expect(stopSpy2).toHaveBeenCalledTimes(1);
  });

  test('start() called twice with path null → exactly one log line recorded', () => {
    // Arrange
    const reloadSpy = vi.fn<() => Promise<ReloadResult>>(() =>
      Promise.resolve({ ok: true, changes: 'test' }),
    );
    const logger = { ...silent, info: vi.fn() };
    const watch = vi.fn();

    const watcher = createConfigWatcher({
      path: null,
      reload: reloadSpy,
      logger,
      pollIntervalMs: 100,
      watch,
    });

    // Act - start twice with null path
    watcher.start();
    watcher.start();

    // Assert - exactly one log line recorded
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      'live config reload disabled (no config file)',
    );
    expect(watch).not.toHaveBeenCalled();
  });
});
