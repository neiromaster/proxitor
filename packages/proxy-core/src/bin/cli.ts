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
  deps: {
    on(signal: 'SIGINT' | 'SIGTERM', handler: () => void): void;
    exit(code: number): void;
  },
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
    on: register,
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
  handler: async args => {
    const io = createWizardIo(createClackPrompt(), args.out ?? defaultWritePath());
    const code = await runWizard({ force: args.force }, io);
    if (code !== 0) process.exit(code);
  },
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
  handler: async args => {
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
  },
});
