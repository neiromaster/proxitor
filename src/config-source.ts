import { type Stats, unwatchFile, watchFile } from 'node:fs';
import {
  buildProviderRouting,
  type LoadConfigOptions,
  loadConfig,
  type ProxyConfig,
  tryFindConfigFile,
} from './config.js';
import { logger } from './logger.js';

function fmt(value: unknown): string {
  if (value === undefined) return 'unset';
  if (value === true) return 'on';
  if (value === false) return 'off';
  return String(value);
}

const SCALAR_KEYS = [
  'cacheControl',
  'cacheControlTtl',
  'sessionId',
  'normalizeVolatileSystem',
  'authType',
  'verbose',
  'bodyLimit',
  'openrouterBaseUrl',
] as const;

function canonicalEntries(record: Record<string, unknown> | undefined): string {
  if (!record) return '';
  return JSON.stringify(
    Object.keys(record)
      .sort()
      .map(key => [key, record[key]]),
  );
}

/** Diff of cache-relevant fields; '' if nothing changed. */
export function summarizeChanges(prev: ProxyConfig, next: ProxyConfig): string {
  const parts: string[] = [];

  for (const key of SCALAR_KEYS) {
    if (prev[key] !== next[key]) {
      parts.push(`${key}: ${fmt(prev[key])}→${fmt(next[key])}`);
    }
  }

  const prevRouting = JSON.stringify(buildProviderRouting(prev.provider));
  const nextRouting = JSON.stringify(buildProviderRouting(next.provider));
  if (prevRouting !== nextRouting) parts.push('provider routing');

  if (canonicalEntries(prev.modelOverrides) !== canonicalEntries(next.modelOverrides)) {
    const prevCount = prev.modelOverrides ? Object.keys(prev.modelOverrides).length : 0;
    const nextCount = next.modelOverrides ? Object.keys(next.modelOverrides).length : 0;
    parts.push(`modelOverrides: ${prevCount}→${nextCount}`);
  }

  if (canonicalEntries(prev.headers) !== canonicalEntries(next.headers)) {
    parts.push('headers');
  }

  return parts.join(', ');
}

export type ReloadResult = { ok: true } | { ok: false; error: string };

export type ConfigSource = {
  get(): ProxyConfig;
  reload(): Promise<ReloadResult>;
  start(): void;
  stop(): void;
  readonly resolvedPath: string | null;
};

export type ConfigSourceOptions = {
  loadOptions: LoadConfigOptions;
  initial: ProxyConfig;
  /** Loader override for tests; defaults to loadConfig. */
  load?: (opts: LoadConfigOptions) => Promise<ProxyConfig>;
  /** watchFile poll interval (ms). */
  pollIntervalMs?: number;
};

export function staticConfigSource(config: ProxyConfig): ConfigSource {
  return {
    get: () => config,
    reload: async () => ({ ok: true }),
    start: () => {},
    stop: () => {},
    resolvedPath: null,
  };
}

export function createConfigSource(options: ConfigSourceOptions): ConfigSource {
  return new FileWatchingConfigSource(options);
}

class FileWatchingConfigSource implements ConfigSource {
  private current: ProxyConfig;
  private readonly loadOptions: LoadConfigOptions;
  private readonly load: (opts: LoadConfigOptions) => Promise<ProxyConfig>;
  private readonly pollIntervalMs: number;
  private readonly boundHost: string;
  private readonly boundPort: number;
  readonly resolvedPath: string | null;
  private loading: boolean = false;
  private pending: boolean = false;
  private watching: boolean = false;

  constructor(options: ConfigSourceOptions) {
    this.current = options.initial;
    this.loadOptions = options.loadOptions;
    this.load = options.load ?? loadConfig;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.boundHost = options.initial.host;
    this.boundPort = options.initial.port;
    this.resolvedPath = options.loadOptions.noConfig
      ? null
      : tryFindConfigFile(options.loadOptions.configPath);
  }

  get(): ProxyConfig {
    return this.current;
  }

  async reload(): Promise<ReloadResult> {
    if (this.loading) {
      this.pending = true;
      return { ok: true };
    }
    this.loading = true;
    try {
      const next = await this.load(this.loadOptions);
      const restartNeeded = next.host !== this.boundHost || next.port !== this.boundPort;
      let diff = '';
      try {
        diff = summarizeChanges(this.current, next);
      } catch {
        diff = '';
      }
      this.current = next;
      if (restartNeeded) {
        logger.warn(
          'host/port changed — restart proxitor to apply (live reload does not re-bind the socket)',
        );
      }
      logger.info(`Config reloaded${diff ? ` — ${diff}` : ' (no material changes)'}`);
      return { ok: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Config reload failed — keeping previous config: ${msg}`);
      return { ok: false, error: msg };
    } finally {
      this.loading = false;
      if (this.pending) {
        this.pending = false;
        void this.reload();
      }
    }
  }

  start(): void {
    if (this.watching) return;
    if (!this.resolvedPath) {
      logger.info('Live config reload disabled (no config file)');
      return;
    }
    this.watching = true;
    const path = this.resolvedPath;
    watchFile(
      path,
      { interval: this.pollIntervalMs, persistent: false },
      (curr: Stats, prev: Stats) => {
        try {
          this.onStat(path, curr, prev);
        } catch {
          /* never leak to the watcher */
        }
      },
    );
  }

  private onStat(path: string, curr: Stats, prev: Stats): void {
    if (curr.nlink === 0) {
      logger.warn(`config file disappeared — keeping current config (${path})`);
      return;
    }
    if (curr.mtimeMs === prev.mtimeMs) return;
    void this.reload();
  }

  stop(): void {
    if (this.watching && this.resolvedPath) {
      unwatchFile(this.resolvedPath);
      this.watching = false;
    }
  }
}
