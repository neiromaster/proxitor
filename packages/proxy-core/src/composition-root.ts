import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { LoggerPort } from '@proxitor/plugin-api';
import type { Hono } from 'hono';
import { createConfigFile } from './adapters/config-file.js';
import { type ConfigWatcher, createConfigWatcher } from './adapters/config-watch.js';
import { createCredentialAdapter } from './adapters/credentials.js';
import {
  createControlPlaneApp,
  routingViewOf,
} from './adapters/inbound/control-plane.js';
import { createProxyApp } from './adapters/inbound/hono-app.js';
import { consolaLogger } from './adapters/logger.js';
import { DumpSink, LiveLineSink } from './adapters/observability-sinks.js';
import { createFetchUpstream } from './adapters/upstream-fetch-adapter.js';
import { validateActivation } from './application/activation-check.js';
import {
  type ProxyConfig,
  parseConfig,
  redactConfigForLog,
} from './application/config-schema.js';
import {
  createHotReload,
  type ReloadResult,
  type RuntimeState,
} from './application/hot-reload.js';
import type { ObservabilityPort, ObservationSink } from './application/observability.js';
import { createObservability } from './application/observability.js';
import { createPluginManager, type PluginManager } from './application/plugin-manager.js';
import { createPipeline, type ProxyPipeline } from './application/proxy-pipeline.js';
import { createRoutingTable, type RoutingTable } from './domain/index.js';
import { createBuiltInPluginRegistry } from './plugins/built-in/index.js';

/**
 * Extract credential refs from config for preloading.
 * Returns non-string credential references (env refs, file refs, etc.).
 */
function credentialRefsOf(
  config: ProxyConfig,
): Array<{ env: string } | { file: string }> {
  const refs: Array<{ env: string } | { file: string }> = [];

  // Provider credentials
  for (const provider of Object.values(config.providers)) {
    const ref = provider.auth.credential;
    if (typeof ref !== 'string') {
      refs.push(ref);
    }
  }

  // Control-plane token (if present and not a plain string)
  if (config.controlPlane !== undefined) {
    const tokenRef = config.controlPlane.token;
    if (typeof tokenRef !== 'string') {
      refs.push(tokenRef);
    }
  }

  return refs;
}

export type Proxitor = {
  readonly app: Hono;
  readonly config: ProxyConfig;
  readonly table: RoutingTable;
  readonly manager: PluginManager;
  readonly pipeline: ProxyPipeline;
  readonly observability: ObservabilityPort;
  readonly reload: () => Promise<ReloadResult>;
  readonly watcher: ConfigWatcher;
};

export type CreateProxitorOptions = {
  readonly configPath?: string;
  /** Config text takes precedence over the file search (tests / embedded). */
  readonly configText?: string;
  readonly verbose?: boolean;
  readonly logger?: LoggerPort;
  readonly env?: Record<string, string | undefined>;
  readonly readFile?: (path: string) => Promise<string>;
  readonly stat?: (path: string) => Promise<{ mode: number }>;
  readonly fetchImpl?: typeof fetch;
  readonly sinks?: readonly ObservationSink[];
};

/** Composition root (spec §3.1, D13): the only assembler. Throws on any load failure. */
export async function createProxitor(options: CreateProxitorOptions): Promise<Proxitor> {
  const logger = options.logger ?? consolaLogger(options.verbose ?? false);
  const env = options.env ?? process.env;

  const files = createConfigFile({ env, readFile: options.readFile });
  const source =
    options.configText !== undefined
      ? { text: options.configText, path: '<memory>' }
      : await files.findAndRead(options.configPath);
  const config = parseConfig(files.parse(source.text, source.path));

  const credentials = createCredentialAdapter({
    env,
    readFile: options.readFile,
    stat: options.stat,
  });
  await credentials.preload(credentialRefsOf(config));

  const manager = createPluginManager({ plugins: createBuiltInPluginRegistry(), logger });
  validateActivation(config, manager);

  // Construct sinks (options.sinks override defaults)
  const sinks: readonly ObservationSink[] = options.sinks ?? [
    new LiveLineSink({ info: line => logger.info(line) }),
    new DumpSink({
      env,
      writeFile,
      mkdir,
      logger,
      maxConcurrent: 16,
      maxWaiters: 256,
    }),
  ];

  // Create observability (always created now)
  const observability = createObservability({
    config: config.observability,
    sinks,
    logger,
    wantsOutboundBody: () => env.PROXITOR_DUMP_BODY === '1',
  });

  // Create hot-reload with initial state
  const initialTable = createRoutingTable({
    providers: config.providers,
    models: config.models,
    plugins: config.plugins,
    defaultProvider: config.defaultProvider,
  });
  const initial: RuntimeState = { config, table: initialTable };

  const readResolved = async (filePath: string): Promise<ProxyConfig> => {
    const readFileImpl = options.readFile ?? ((path: string) => readFile(path, 'utf-8'));
    const text = await readFileImpl(filePath);
    return parseConfig(files.parse(text, filePath));
  };

  const readNext = async (): Promise<ProxyConfig> => {
    // configText has no backing file — re-parse the stored text instead of
    // reading a path that does not exist on disk. The text is immutable, so
    // such a reload is a no-op change (env refs were resolved at startup).
    if (source.path === '<memory>') {
      return parseConfig(files.parse(source.text, source.path));
    }
    return readResolved(source.path);
  };

  const hotReload = createHotReload({
    initial,
    deps: {
      readNext,
      buildTable: cfg =>
        createRoutingTable({
          providers: cfg.providers,
          models: cfg.models,
          plugins: cfg.plugins,
          defaultProvider: cfg.defaultProvider,
        }),
      validate: cfg => validateActivation(cfg, manager),
      preloadCredentials: cfg => credentials.preload(credentialRefsOf(cfg)),
      reconfigure: cfg => observability.reconfigure(cfg.observability),
      logger,
    },
  });

  // Create pipeline with hot-reload facade table
  const pipeline = createPipeline({
    table: hotReload.swap.table,
    manager,
    fetch: createFetchUpstream({ fetchImpl: options.fetchImpl }),
    credentials,
    logger,
    clock: { now: () => Date.now() },
    random: { uuid: () => crypto.randomUUID() },
    forwardHeaders: config.server.forwardHeaders,
    observability,
  });

  const app = createProxyApp({ pipeline, bodyLimitBytes: config.server.bodyLimitBytes });

  // D16: control-plane is mounted unconditionally — the token is resolved per
  // request from the live config so reloads rotate it without a restart.
  // Absent or unresolvable token → 404, identical to the unmounted state.
  app.route(
    '/control',
    createControlPlaneApp({
      getToken: () => {
        const cp = hotReload.swap.current.config.controlPlane;
        if (cp === undefined) return undefined;
        try {
          return credentials.resolve(cp.token);
        } catch {
          return undefined; // fail closed → 404, never a 500 leak
        }
      },
      reload: () => hotReload.reload(),
      routingView: () => routingViewOf(hotReload.swap.current.config),
    }),
  );

  logger.info('config loaded', { path: source.path, config: redactConfigForLog(config) });

  // Create config file watcher (null path for configText means no watching)
  const watchablePath = source.path === '<memory>' ? null : source.path;
  const watcher = createConfigWatcher({
    path: watchablePath,
    reload: () => hotReload.reload(),
    logger,
  });

  // Return proxitor with delegating config and table, plus reload and watcher
  return {
    app,
    get config(): ProxyConfig {
      return hotReload.swap.current.config;
    },
    get table(): RoutingTable {
      return hotReload.swap.table;
    },
    manager,
    pipeline,
    observability,
    reload: () => hotReload.reload(),
    watcher,
  };
}
