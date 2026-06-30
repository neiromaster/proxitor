import { type Stats, unwatchFile, watchFile } from 'node:fs';
import {
  buildProviderRouting,
  detectSlugCollisions,
  formatSlugCollisionWarning,
  type LoadConfigOptions,
  loadConfig,
  type ModelOverride,
  type ProxyConfig,
  tryFindConfigFile,
} from './config.js';
import { logger } from './logger.js';

type WatchFn = (
  filename: string,
  pollIntervalMs: number,
  onChange: (curr: Stats, prev: Stats) => void,
) => () => void;

/** Default watcher: fs.watchFile polling; returns a stop function. */
const watchStat: WatchFn = (filename, pollIntervalMs, onChange) => {
  watchFile(filename, { interval: pollIntervalMs, persistent: false }, onChange);
  return () => unwatchFile(filename);
};

function fmt(value: unknown): string {
  if (value === undefined) return 'unset';
  if (value === true) return 'on';
  if (value === false) return 'off';
  return String(value);
}

/** Cache-lever keys shared by global config + per-model overrides. */
const CACHE_LEVER_KEYS = [
  'cacheControl',
  'cacheControlTtl',
  'sessionId',
  'normalizeVolatileSystem',
] as const;

// Scalar fields surfaced in the reload diff; extends CACHE_LEVER_KEYS with the remaining fix fields + `recommended`.
const SCALAR_KEYS = [
  ...CACHE_LEVER_KEYS,
  'rewriteBlockTtl',
  'normalizeResponses',
  'normalizeMessages',
  'recommended',
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

/** Field-level diff for a single model override; '' if nothing changed. */
function overrideFieldDiff(
  prev: ModelOverride | undefined,
  next: ModelOverride | undefined,
): string {
  const parts: string[] = [];
  for (const key of CACHE_LEVER_KEYS) {
    if (prev?.[key] !== next?.[key]) {
      parts.push(`${key}: ${fmt(prev?.[key])}→${fmt(next?.[key])}`);
    }
  }
  if (
    JSON.stringify(buildProviderRouting(prev?.provider)) !==
    JSON.stringify(buildProviderRouting(next?.provider))
  ) {
    parts.push('provider routing');
  }
  if (canonicalEntries(prev?.headers) !== canonicalEntries(next?.headers)) {
    parts.push('headers');
  }
  return parts.join(', ');
}

/** Per-override diff: +added, -removed, `key (fields)` for modified; '' if unchanged. */
function summarizeModelOverridesDiff(
  prev: ProxyConfig['modelOverrides'],
  next: ProxyConfig['modelOverrides'],
): string {
  const prevKeys = new Set(Object.keys(prev ?? {}));
  const nextKeys = new Set(Object.keys(next ?? {}));
  const parts: string[] = [];

  for (const key of [...new Set([...prevKeys, ...nextKeys])].sort()) {
    const inPrev = prevKeys.has(key);
    const inNext = nextKeys.has(key);
    if (inPrev && inNext) {
      const fields = overrideFieldDiff(prev?.[key], next?.[key]);
      if (fields) parts.push(`${key} (${fields})`);
    } else if (inNext) {
      parts.push(`+${key}`);
    } else {
      parts.push(`-${key}`);
    }
  }
  return parts.join(', ');
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

  const overridesDiff = summarizeModelOverridesDiff(
    prev.modelOverrides,
    next.modelOverrides,
  );
  if (overridesDiff) parts.push(`modelOverrides: ${overridesDiff}`);

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
  /** Register a listener fired after a successful reload. Returns an unsubscribe. */
  subscribe(listener: (config: ProxyConfig) => void): () => void;
  readonly resolvedPath: string | null;
};

export type ConfigSourceOptions = {
  loadOptions: LoadConfigOptions;
  initial: ProxyConfig;
  /** Loader override for tests; defaults to loadConfig. */
  load?: (opts: LoadConfigOptions) => Promise<ProxyConfig>;
  /** watchFile poll interval (ms). */
  pollIntervalMs?: number;
  /** Watcher override for tests; defaults to fs.watchFile polling. */
  watch?: WatchFn;
};

export function staticConfigSource(config: ProxyConfig): ConfigSource {
  return {
    get: () => config,
    reload: async () => ({ ok: true }),
    start: () => {},
    stop: () => {},
    subscribe: () => () => {},
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
  private readonly watch: WatchFn;
  private readonly boundHost: string;
  private readonly boundPort: number;
  readonly resolvedPath: string | null;
  private stopWatch?: () => void;
  private loading: boolean = false;
  private pending: boolean = false;
  private watching: boolean = false;
  private lastCollisionSig = '';
  private readonly listeners: Array<(config: ProxyConfig) => void> = [];

  constructor(options: ConfigSourceOptions) {
    this.current = options.initial;
    this.warnSlugCollisions(options.initial.modelOverrides);
    this.loadOptions = options.loadOptions;
    this.load = options.load ?? loadConfig;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.watch = options.watch ?? watchStat;
    this.boundHost = options.initial.host;
    this.boundPort = options.initial.port;
    this.resolvedPath = options.loadOptions.noConfig
      ? null
      : tryFindConfigFile(options.loadOptions.configPath);
  }

  get(): ProxyConfig {
    return this.current;
  }

  subscribe(listener: (config: ProxyConfig) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  /** Notify subscribers after a successful reload. A throwing subscriber
   * must not abort the reload or skip the remaining subscribers. */
  private notify(config: ProxyConfig): void {
    for (const listener of this.listeners) {
      try {
        listener(config);
      } catch {
        /* never leak subscriber errors to the reload path */
      }
    }
  }

  /** Warn only when the collision set changes, so reloading an unchanged config doesn't re-log. */
  private warnSlugCollisions(overrides: ProxyConfig['modelOverrides']): void {
    const collisions = detectSlugCollisions(overrides ?? undefined);
    // Order-independent identity (slug + winner + sorted keys): a key reorder
    // re-warns only if it changes which key wins.
    const sig = collisions
      .map(c =>
        [c.slug, c.winner, [...c.keys].sort((a, b) => a.localeCompare(b)).join(',')].join(
          '|',
        ),
      )
      .sort((a, b) => a.localeCompare(b))
      .join('||');
    if (sig === this.lastCollisionSig) return;
    this.lastCollisionSig = sig;
    for (const collision of collisions) {
      logger.warn(formatSlugCollisionWarning(collision));
    }
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
      this.warnSlugCollisions(next.modelOverrides);
      if (restartNeeded) {
        logger.warn(
          'host/port changed — restart proxitor to apply (live reload does not re-bind the socket)',
        );
      }
      logger.info(`Config reloaded${diff ? ` — ${diff}` : ' (no material changes)'}`);
      this.notify(next);
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
    this.stopWatch = this.watch(path, this.pollIntervalMs, (curr, prev) => {
      try {
        this.onStat(path, curr, prev);
      } catch {
        /* never leak to the watcher */
      }
    });
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
    if (this.watching) {
      this.stopWatch?.();
      this.stopWatch = undefined;
      this.watching = false;
    }
  }
}
