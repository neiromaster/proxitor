import type { LoggerPort } from '@proxitor/plugin-api';
import type { RoutingTable } from '../domain/index.js';
import type { ProxyConfig } from './config-schema.js';

export type RuntimeState = {
  readonly config: ProxyConfig;
  readonly table: RoutingTable;
};

export type RuntimeSwap = {
  readonly current: RuntimeState;
  readonly table: RoutingTable; // stable delegating facade
  swap(next: RuntimeState): void;
};

export type ReloadResult =
  | { readonly ok: true; readonly changes: string }
  | { readonly ok: false; readonly error: string };

export type HotReloadDeps = {
  readNext(): Promise<ProxyConfig>; // throws on unreadable/invalid
  buildTable(config: ProxyConfig): RoutingTable; // throws RoutingConfigError
  validate(config: ProxyConfig): void; // validateActivation wrapper, throws
  preloadCredentials(config: ProxyConfig): Promise<void>; // D16 fail-fast, throws
  reconfigure(config: ProxyConfig): void; // observability.reconfigure wrapper
  logger: LoggerPort;
};

export type HotReload = {
  readonly swap: RuntimeSwap;
  reload(): Promise<ReloadResult>;
};

/**
 * Create a runtime swap facade that delegates to the current routing table.
 * The facade object reference stays stable across swaps — inflight requests
 * holding the old reference continue using the old table, while new requests
 * see the updated table.
 */
export function createRuntimeSwap(initial: RuntimeState): RuntimeSwap {
  let current = initial;

  const facade: RoutingTable = {
    resolve(logicalModel: string, path: string) {
      return current.table.resolve(logicalModel, path);
    },
    resolveModelLess(path: string) {
      return current.table.resolveModelLess(path);
    },
    listModels() {
      return current.table.listModels();
    },
  };

  return {
    get current() {
      return current;
    },
    table: facade,
    swap(next: RuntimeState) {
      current = next;
    },
  };
}

/**
 * Check if server restart keys changed — these require restart to apply.
 * Compares host, port, bodyLimitBytes, and forwardHeaders (JSON equality).
 */
function restartKeysChanged(prev: ProxyConfig, next: ProxyConfig): boolean {
  return (
    JSON.stringify(prev.server.host) !== JSON.stringify(next.server.host) ||
    JSON.stringify(prev.server.port) !== JSON.stringify(next.server.port) ||
    JSON.stringify(prev.server.bodyLimitBytes) !==
      JSON.stringify(next.server.bodyLimitBytes) ||
    JSON.stringify(prev.server.forwardHeaders) !==
      JSON.stringify(next.server.forwardHeaders)
  );
}

/**
 * Summarize configuration diff for logging.
 * Returns empty string when configs are JSON-equal on the operational keys
 * (providers, models, plugins, defaultProvider, observability).
 * Otherwise returns section-level parts:
 * - providers as `+id`/`-id`/`id (changed)`
 * - models as `+match`/`-match`/`match (provider/modelId changed)`
 * - plus `plugins`, `defaultProvider`, `observability` when their canonical JSON differs
 *
 * Server keys are deliberately NOT in the diff (they belong to the restart-warning).
 */
function diffProviders(prev: ProxyConfig, next: ProxyConfig, parts: string[]): void {
  const allProviderIds = new Set([
    ...Object.keys(prev.providers),
    ...Object.keys(next.providers),
  ]);

  for (const id of allProviderIds) {
    const prevProvider = prev.providers[id];
    const nextProvider = next.providers[id];

    if (prevProvider === undefined) {
      parts.push(`+${id}`);
    } else if (nextProvider === undefined) {
      parts.push(`-${id}`);
    } else if (JSON.stringify(prevProvider) !== JSON.stringify(nextProvider)) {
      parts.push(`${id} (changed)`);
    }
  }
}

function diffModels(prev: ProxyConfig, next: ProxyConfig, parts: string[]): void {
  const prevModels = new Map(prev.models.map(m => [m.match, m]));
  const nextModels = new Map(next.models.map(m => [m.match, m]));
  const allMatches = new Set([...prevModels.keys(), ...nextModels.keys()]);

  for (const match of allMatches) {
    const prevModel = prevModels.get(match);
    const nextModel = nextModels.get(match);

    if (prevModel === undefined) {
      parts.push(`+${match}`);
    } else if (nextModel === undefined) {
      parts.push(`-${match}`);
    } else if (
      prevModel.provider !== nextModel.provider ||
      prevModel.modelId !== nextModel.modelId
    ) {
      parts.push(`${match} (changed)`);
    }
  }
}

function diffMisc(prev: ProxyConfig, next: ProxyConfig, parts: string[]): void {
  if (JSON.stringify(prev.plugins) !== JSON.stringify(next.plugins)) {
    parts.push('plugins');
  }
  if (prev.defaultProvider !== next.defaultProvider) {
    parts.push('defaultProvider');
  }
  if (JSON.stringify(prev.observability) !== JSON.stringify(next.observability)) {
    parts.push('observability');
  }
}

export function summarizeConfigDiff(prev: ProxyConfig, next: ProxyConfig): string {
  const parts: string[] = [];
  diffProviders(prev, next, parts);
  diffModels(prev, next, parts);
  diffMisc(prev, next, parts);
  return parts.join(', ');
}

/**
 * Create hot-reload instance with keep-last-valid semantics.
 *
 * State handoff (spec §11 "state-handoff по name"): in v1 the plugin registry
 * instances are singletons created once in the composition root — their state
 * (e.g. session-id's sticky map) survives reload by construction, so no
 * exportState/restoreState round-trip happens on reload. The manager.snapshot/
 * restore methods remain available but are unused here.
 *
 * Reload process (never throws, never swaps on failure):
 * 1. Coalescing guard — concurrent calls return ok:true with coalesced message
 * 2. readNext() → buildTable() → preloadCredentials() → validate()
 * 3. Restart-check — warn if server keys changed
 * 4. swap() → reconfigure() → log success
 * 5. Any error → log failure, return {ok:false}, keep previous config
 */
export function createHotReload(options: {
  initial: RuntimeState;
  deps: HotReloadDeps;
}): HotReload {
  const { initial, deps } = options;
  let loading = false;
  let pending = false;

  const swap = createRuntimeSwap(initial);

  const reload = async (): Promise<ReloadResult> => {
    // Coalescing guard
    if (loading) {
      pending = true;
      return { ok: true, changes: 'reload already in progress — coalesced' };
    }

    loading = true;
    const logger = deps.logger;

    try {
      // Apply reload steps
      const nextConfig = await deps.readNext();
      const nextTable = deps.buildTable(nextConfig);
      await deps.preloadCredentials(nextConfig);
      deps.validate(nextConfig);

      // Restart-check
      if (restartKeysChanged(swap.current.config, nextConfig)) {
        logger.warn(
          'host/port/bodyLimit/forwardHeaders changed — restart proxitor to apply (live reload does not re-bind the socket or body parser)',
        );
      }

      // Swap and reconfigure
      const changes = summarizeConfigDiff(swap.current.config, nextConfig);
      swap.swap({ config: nextConfig, table: nextTable });
      deps.reconfigure(nextConfig);

      logger.info(`config reloaded — ${changes}`);
      return { ok: true, changes };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`config reload failed — keeping previous config: ${message}`, {
        error,
      });
      return { ok: false, error: message };
    } finally {
      loading = false;
      // Re-run if a concurrent request came in
      if (pending) {
        pending = false;
        // Schedule next tick to avoid recursion
        setImmediate(() => {
          reload().catch(err => {
            logger.debug('coalesced reload retry failed', { error: err });
          });
        });
      }
    }
  };

  return { swap, reload };
}
