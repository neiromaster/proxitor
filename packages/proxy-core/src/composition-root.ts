import { mkdir, writeFile } from 'node:fs/promises';
import type { LoggerPort } from '@proxitor/plugin-api';
import type { Hono } from 'hono';
import { createConfigFile } from './adapters/config-file.js';
import { createCredentialAdapter } from './adapters/credentials.js';
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
import type { ObservabilityPort, ObservationSink } from './application/observability.js';
import { createObservability } from './application/observability.js';
import { createPluginManager, type PluginManager } from './application/plugin-manager.js';
import { createPipeline, type ProxyPipeline } from './application/proxy-pipeline.js';
import { createRoutingTable, type RoutingTable } from './domain/index.js';
import { createBuiltInPluginRegistry } from './plugins/built-in/index.js';

export type Proxitor = {
  readonly app: Hono;
  readonly config: ProxyConfig;
  readonly table: RoutingTable;
  readonly manager: PluginManager;
  readonly pipeline: ProxyPipeline;
  readonly observability: ObservabilityPort | undefined;
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
  await credentials.preload(
    Object.values(config.providers)
      .map(provider => provider.auth.credential)
      .filter(ref => typeof ref !== 'string'),
  );

  const table = createRoutingTable({
    providers: config.providers,
    models: config.models,
    plugins: config.plugins,
    defaultProvider: config.defaultProvider,
  });
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

  // Create observability (Task 5 will capture this for reconfigure)
  const observability = createObservability({
    config: config.observability,
    sinks,
    logger,
    wantsOutboundBody: () => env.PROXITOR_DUMP_BODY === '1',
  });

  const pipeline = createPipeline({
    table,
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
  logger.info('config loaded', { path: source.path, config: redactConfigForLog(config) });
  return { app, config, table, manager, pipeline, observability };
}
