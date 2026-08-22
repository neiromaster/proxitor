import { readFile, stat } from 'node:fs/promises';
import { type ServerType, serve } from '@hono/node-server';
import { command, flag, number, option, optional, string, subcommands } from 'cmd-ts';
import { defaultWritePath } from '../adapters/config-file.js';
import { createWizardIo, runWizard } from '../adapters/config-wizard.js';
import { createClackPrompt } from '../adapters/prompt-clack.js';
import {
  type CreateProxitorOptions,
  createProxitor,
  type Proxitor,
} from '../composition-root.js';
import { createNetBindProbe, renderJson, renderText, runDoctor } from './doctor.js';

/** Server type with closeIdleConnections for graceful shutdown. */
type ServerWithShutdown = Pick<ServerType, 'close' | 'on'> & {
  closeIdleConnections(): void;
};

/** Shared command-handler guard: catches errors, logs them, and exits. */
export function runGuarded<T>(
  run: (args: T) => Promise<void>,
): (args: T) => Promise<void> {
  return async args => {
    try {
      await run(args);
    } catch (error) {
      console.error(
        `proxitor: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }
  };
}

export type StartOptions = {
  readonly config?: string;
  readonly host?: string;
  readonly port?: number;
  readonly verbose: boolean;
};

export type StartDeps = {
  readonly createApp?: (options: CreateProxitorOptions) => Promise<Proxitor>;
  readonly serveImpl?: typeof serve;
  /** Signal registration seam (tests); defaults to process.on (not once). */
  readonly registerSignal?: (signal: 'SIGINT' | 'SIGTERM', handler: () => void) => void;
};

/** Wire shutdown: drain, close the server, then exit cleanly. */
export function registerShutdown(
  server: ServerWithShutdown,
  deps: {
    on(signal: 'SIGINT' | 'SIGTERM', handler: () => void): void;
    exit(code: number): void;
    log(message: string): void;
    onBeforeExit?(): void;
  },
): void {
  let secondSignal = false;
  let exited = false;

  const doExit = (code: number) => {
    if (!exited) {
      exited = true;
      deps.exit(code);
    }
  };

  const shutdown = () => {
    if (secondSignal) {
      // Second signal before close finished: immediate exit
      doExit(0);
      return;
    }

    // First signal: drain and close
    secondSignal = true;
    deps.log('shutting down — press Ctrl-C again to force exit');

    // Wrap onBeforeExit in try/catch to prevent shutdown hang
    try {
      deps.onBeforeExit?.();
    } catch (error) {
      deps.log(
        `shutdown: onBeforeExit failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    server.closeIdleConnections();
    server.close(() => doExit(0));
  };

  deps.on('SIGINT', shutdown);
  deps.on('SIGTERM', shutdown);
}

/** Wire listen errors to a clean one-line failure (instead of a raw stack). */
export function wireListenError(
  server: { on(event: 'error', listener: (error: Error) => void): unknown },
  host: string,
  port: number,
  handlers: { fail(message: string): void },
): void {
  server.on('error', error => {
    handlers.fail(`cannot listen on ${host}:${port} — ${error.message}`);
  });
}

export async function runStart(
  options: StartOptions,
  deps: StartDeps = {},
): Promise<void> {
  const createApp = deps.createApp ?? createProxitor;
  const doServe = deps.serveImpl ?? serve;
  const register =
    deps.registerSignal ?? ((signal, handler) => process.on(signal, handler));

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
  wireListenError(server, hostname, port, {
    fail: message => {
      console.error(`proxitor: ${message}`);
      process.exit(1);
    },
  });
  registerShutdown(server as ServerWithShutdown, {
    on: register,
    exit: code => process.exit(code),
    log: line => console.log(line),
    onBeforeExit: () => proxitor.watcher.stop(),
  });

  // Start the config watcher after serve succeeds
  proxitor.watcher.start();
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
  handler: runGuarded(async (options: StartOptions) => {
    await runStart(options);
  }),
});

export const configWizardCommand = command({
  name: 'wizard',
  description: 'Interactive config generator (writes a spec §6 YAML)',
  args: {
    out: option({
      long: 'out',
      type: optional(string),
      description: 'Target path (default: XDG config.yaml)',
    }),
    force: flag({
      long: 'force',
      description: 'Overwrite an existing config without asking',
    }),
  },
  handler: runGuarded(async (args: { out?: string; force?: boolean }) => {
    const io = createWizardIo(createClackPrompt(), args.out ?? defaultWritePath());
    const code = await runWizard({ force: args.force }, io);
    if (code !== 0) process.exit(code);
  }),
});

export const configCli = subcommands({
  name: 'config',
  description: 'Manage proxy configuration',
  cmds: {
    wizard: configWizardCommand,
  },
});

export const doctorCommand = command({
  name: 'doctor',
  description: 'Diagnose environment and configuration',
  args: {
    config: option({
      long: 'config',
      type: optional(string),
      description: 'Config file path (default: XDG search)',
    }),
    json: flag({ long: 'json', description: 'Machine-readable JSON output' }),
  },
  handler: runGuarded(async (args: { config?: string; json?: boolean }) => {
    const report = await runDoctor(
      { configPath: args.config },
      {
        env: process.env,
        readFile: path => readFile(path, 'utf8'),
        stat,
        bindProbe: createNetBindProbe(),
      },
    );
    const output = args.json ? renderJson(report) : renderText(report);
    console.log(output);
    if (report.exitCode !== 0) process.exit(report.exitCode);
  }),
});
