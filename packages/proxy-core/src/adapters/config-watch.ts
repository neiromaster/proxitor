import type { Stats } from 'node:fs';
import { unwatchFile, watchFile } from 'node:fs';
import type { LoggerPort } from '@proxitor/plugin-api';
import type { ReloadResult } from '../application/hot-reload.js';

export type ConfigWatcher = {
  readonly start: () => void;
  readonly stop: () => void;
};

export function createConfigWatcher(options: {
  readonly path: string | null;
  readonly reload: () => Promise<ReloadResult>;
  readonly logger: LoggerPort;
  readonly pollIntervalMs?: number;
  readonly watch?: (
    filename: string,
    pollIntervalMs: number,
    onChange: (curr: Stats, prev: Stats) => void,
  ) => () => void;
}): ConfigWatcher {
  const { path, reload, logger, pollIntervalMs = 1000, watch = defaultWatch } = options;

  let watching = false;
  let stopWatch: (() => void) | null = null;
  let nullPathAnnounced = false;

  const start = (): void => {
    if (path === null) {
      if (!nullPathAnnounced) {
        logger.info('live config reload disabled (no config file)');
        nullPathAnnounced = true;
      }
      return;
    }

    if (watching) {
      return;
    }

    watching = true;
    stopWatch = watch(path, pollIntervalMs, (curr: Stats, prev: Stats) => {
      // File disappeared - keep current config
      if (curr.nlink === 0) {
        logger.warn(`config file disappeared — keeping current config (${path})`);
        return;
      }

      // mtime unchanged - no reload needed
      if (curr.mtimeMs === prev.mtimeMs) {
        return;
      }

      // File changed - trigger reload (swallow errors, never leak to watcher)
      void reload().catch((error: Error) => {
        logger.error('config reload failed', { error });
      });
    });
  };

  const stop = (): void => {
    if (!watching) {
      return;
    }

    watching = false;
    if (stopWatch) {
      stopWatch();
      stopWatch = null;
    }
  };

  return { start, stop };
}

/**
 * Default watch implementation using fs.watchFile with legacy watchStat semantics.
 * persistent: false means we need to manually call unwatchFile to stop watching.
 */
function defaultWatch(
  filename: string,
  pollIntervalMs: number,
  onChange: (curr: Stats, prev: Stats) => void,
): () => void {
  watchFile(filename, { interval: pollIntervalMs, persistent: false }, onChange);
  return () => {
    unwatchFile(filename);
  };
}
