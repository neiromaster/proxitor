import { type ServerType, serve } from '@hono/node-server';
import { command, flag, number, option, optional, string } from 'cmd-ts';
import {
  type CreateProxitorOptions,
  createProxitor,
  type Proxitor,
} from '../composition-root.js';

export type StartOptions = {
  readonly config?: string;
  readonly host?: string;
  readonly port?: number;
  readonly verbose: boolean;
};

export type StartDeps = {
  readonly createApp?: (options: CreateProxitorOptions) => Promise<Proxitor>;
  readonly serveImpl?: typeof serve;
  /** Signal registration seam (tests); defaults to process.once. */
  readonly registerSignal?: (signal: 'SIGINT' | 'SIGTERM', handler: () => void) => void;
};

/** Wire shutdown: close the server, then exit cleanly. */
export function registerShutdown(
  server: Pick<ServerType, 'close'>,
  deps: { on(signal: string, handler: () => void): void; exit(code: number): void },
): void {
  const shutdown = () => server.close(() => deps.exit(0));
  deps.on('SIGINT', shutdown);
  deps.on('SIGTERM', shutdown);
}

export async function runStart(
  options: StartOptions,
  deps: StartDeps = {},
): Promise<void> {
  const createApp = deps.createApp ?? createProxitor;
  const doServe = deps.serveImpl ?? serve;
  const register =
    deps.registerSignal ?? ((signal, handler) => process.once(signal, handler));

  const proxitor = await createApp({
    configPath: options.config,
    verbose: options.verbose,
  });
  const hostname = options.host ?? proxitor.config.server.host;
  const port = options.port ?? proxitor.config.server.port;
  const server = doServe({ fetch: proxitor.app.fetch, hostname, port }, info => {
    // eslint-disable-next-line no-console -- CLI startup line is the product surface
    console.log(`proxitor listening on http://${info.address}:${info.port}`);
  });
  registerShutdown(server, {
    on: (signal, handler) => register(signal as 'SIGINT' | 'SIGTERM', handler),
    exit: code => process.exit(code),
  });
}

/** Single top-level command (D-M5a-8): subcommands arrive with the M5b wizard. */
export const startCommand = command({
  name: 'start',
  description: 'Start the proxitor gateway',
  args: {
    config: option({
      long: 'config',
      type: optional(string),
      description: 'Config file path (default: XDG search)',
    }),
    host: option({
      long: 'host',
      type: optional(string),
      description: 'Listen host (default: config server.host)',
    }),
    port: option({
      long: 'port',
      type: optional(number),
      description: 'Listen port (default: config server.port)',
    }),
    verbose: flag({ long: 'verbose', description: 'Verbose logging' }),
  },
  handler: async options => {
    try {
      await runStart(options);
    } catch (error) {
      console.error(
        `proxitor: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }
  },
});
