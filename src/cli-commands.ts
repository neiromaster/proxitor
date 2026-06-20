/**
 * CLI command tree. Separated from `cli.ts` so tests can import commands
 * without triggering `run()`.
 */
import {
  command,
  extendType,
  flag,
  number,
  option,
  optional,
  string,
  subcommands,
  type Type,
} from 'cmd-ts';
import { addOverrideCommand } from './commands/config/add.js';
import { browseModelsCommand } from './commands/config/browse.js';
import { cachingCommand } from './commands/config/caching-menu.js';
import { editOverrideCommand } from './commands/config/edit.js';
import { listOverridesCommand } from './commands/config/list.js';
import { removeOverrideCommand } from './commands/config/remove.js';
import { showConfigCommand } from './commands/config/show.js';
import { validateConfigCommand } from './commands/config/validate.js';
import { runWizard } from './commands/config/wizard.js';
import { runConfigMenu } from './commands/config.js';
import { doctorCommand } from './commands/doctor.js';
import { DEFAULTS, loadConfig } from './config.js';
import { createConfigSource } from './config-source.js';
import { logger } from './logger.js';
import { OpenRouterDataClient } from './openrouter/data-client.js';
import { startProxyServer } from './proxy.js';
import { version } from './version.js';

const ConfigPath: Type<string, string | undefined> = optional(string);

const Port = extendType(number, {
  from: async n => {
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      throw new Error(`Port must be an integer in 1-65535 (got ${n})`);
    }
    return n;
  },
});

/** Undefined when neither `--openrouter-key`/`-k` nor `OPENROUTER_API_KEY` is set; `loadConfig` then falls back to the file's `openrouterKey`. */
const OpenRouterKey: Type<string, string | undefined> = optional(string);

export const configArgs = {
  configPath: option({
    long: 'config',
    short: 'c',
    type: ConfigPath,
    description: 'Path to config file (auto-discovered if omitted)',
  }),
  openrouterKey: option({
    long: 'openrouter-key',
    short: 'k',
    env: 'OPENROUTER_API_KEY',
    type: OpenRouterKey,
    description: 'OpenRouter API key (overrides config file & env)',
  }),
} as const;

export const jsonFlag = {
  json: flag({
    long: 'json',
    description: 'Output as JSON instead of formatted text',
  }),
} as const;

export async function makeClient(args: {
  openrouterKey?: string | undefined;
  configPath?: string | undefined;
}): Promise<OpenRouterDataClient> {
  const cfg = await loadConfig({
    configPath: args.configPath,
    openrouterKey: args.openrouterKey,
  });
  return new OpenRouterDataClient({
    openrouterBaseUrl: cfg.openrouterBaseUrl,
    openrouterDataUrl: cfg.openrouterDataUrl,
    apiKey: cfg.openrouterKey,
    authType: cfg.authType,
    onFallback: (path: string) => {
      let endpoint: string;
      if (path === '/v1/providers') endpoint = 'providers';
      else if (path === '/v1/models') endpoint = 'models';
      else endpoint = 'data';
      logger.warn(`Custom API did not return ${endpoint}, using OpenRouter as fallback`);
    },
  });
}

export const startCommand = command({
  name: 'start',
  aliases: ['up', 'run'],
  version,
  description: 'Start the proxy server (default command)',
  examples: [
    { description: 'Start with auto-discovered config', command: 'proxitor' },
    { description: 'Start on a custom port', command: 'proxitor --port 9000' },
    {
      description: 'Start with an explicit config',
      command: 'proxitor --config ./team.yaml',
    },
    {
      description: 'Use an env var for the API key',
      command: 'OPENROUTER_API_KEY=sk-... proxitor',
    },
  ],
  args: {
    configPath: configArgs.configPath,
    port: option({
      long: 'port',
      short: 'p',
      type: Port,
      description: 'Listen port',
      defaultValue: () => DEFAULTS.port,
      defaultValueIsSerializable: true,
    }),
    host: option({
      long: 'host',
      type: string,
      description: 'Listen host',
      defaultValue: () => DEFAULTS.host,
      defaultValueIsSerializable: true,
    }),
    noConfig: flag({ long: 'no-config', description: 'Skip config file discovery' }),
    openrouterKey: configArgs.openrouterKey,
    verbose: flag({ long: 'verbose', description: 'Enable verbose logging' }),
  },
  handler: async ({ configPath, port, host, noConfig, openrouterKey, verbose }) => {
    try {
      const loadOptions = { configPath, noConfig, port, host, openrouterKey, verbose };
      const cfg = await loadConfig(loadOptions);
      const source = createConfigSource({ loadOptions, initial: cfg });
      source.start();
      startProxyServer(source, () => {
        logger.ready(`Proxitor proxy listening on ${cfg.host}:${cfg.port}`);
        logger.info('Routing requests to OpenRouter');
        if (source.resolvedPath) {
          logger.info(`Watching ${source.resolvedPath} for changes (live reload)`);
        }
      });
    } catch (error) {
      logger.error('Failed to start proxy:', error);
      throw error;
    }
  },
});

export const configCli = subcommands({
  name: 'config',
  description: 'Manage proxy configuration',
  examples: [
    { description: 'Open interactive menu', command: 'proxitor config' },
    { description: 'Run setup wizard', command: 'proxitor config wizard' },
    { description: 'List overrides as JSON', command: 'proxitor config list --json' },
    { description: 'Show resolved config', command: 'proxitor config show' },
  ],
  cmds: {
    add: command({
      name: 'add',
      description: 'Add a model override (interactive)',
      args: { ...configArgs },
      handler: async args => {
        const client = await makeClient(args);
        await addOverrideCommand({ client, configPath: args.configPath });
      },
    }),
    cache: command({
      name: 'cache',
      description: 'Tune prompt-caching settings (interactive)',
      args: { ...configArgs },
      handler: async args => {
        await cachingCommand({ configPath: args.configPath });
      },
    }),
    edit: command({
      name: 'edit',
      description: 'Edit an existing model override (interactive)',
      args: { ...configArgs },
      handler: async args => {
        const client = await makeClient(args);
        await editOverrideCommand(client, args.configPath);
      },
    }),
    remove: command({
      name: 'remove',
      description: 'Remove one or more model overrides (interactive)',
      args: { ...configArgs },
      handler: async args => {
        await removeOverrideCommand({ configPath: args.configPath });
      },
    }),
    list: command({
      name: 'list',
      description: 'List all model overrides',
      args: { ...configArgs, ...jsonFlag },
      handler: async args => {
        await listOverridesCommand({ json: args.json, configPath: args.configPath });
      },
    }),
    browse: command({
      name: 'browse',
      description: 'Browse OpenRouter models (interactive)',
      args: { ...configArgs },
      handler: async args => {
        const client = await makeClient(args);
        await browseModelsCommand(client);
      },
    }),
    validate: command({
      name: 'validate',
      description: 'Validate the current config (exit 0 ok, 1 invalid)',
      args: { ...configArgs, ...jsonFlag },
      handler: async args => {
        const code = await validateConfigCommand({
          json: args.json,
          configPath: args.configPath,
        });
        if (code !== 0) process.exit(code);
      },
    }),
    show: command({
      name: 'show',
      description:
        'Show resolved configuration (merged from defaults + file + env + flags)',
      args: { ...configArgs, ...jsonFlag },
      handler: async args => {
        await showConfigCommand({
          configPath: args.configPath,
          openrouterKey: args.openrouterKey,
          json: args.json,
        });
      },
    }),
    wizard: command({
      name: 'wizard',
      description: 'Run interactive setup wizard',
      args: { ...configArgs },
      handler: async args => {
        await runWizard({ configPath: args.configPath });
      },
    }),
    menu: command({
      name: 'menu',
      description: 'Open interactive configuration menu',
      args: { ...configArgs },
      handler: async args => {
        const client = await makeClient(args);
        await runConfigMenu(client);
      },
    }),
  },
});

export const doctorCli = command({
  name: 'doctor',
  description: 'Diagnose environment and configuration',
  examples: [
    { description: 'Run all checks', command: 'proxitor doctor' },
    { description: 'Skip network checks', command: 'proxitor doctor --offline' },
    { description: 'Output as JSON', command: 'proxitor doctor --json' },
  ],
  args: {
    ...jsonFlag,
    offline: flag({
      long: 'offline',
      description: 'Skip network checks (upstream, npm)',
    }),
    timeout: option({
      long: 'timeout',
      short: 't',
      type: optional(string),
      description: 'Network check timeout in milliseconds',
    }),
  },
  handler: async ({ json, offline, timeout }) => {
    const parsed = timeout ? Number.parseInt(timeout, 10) : undefined;
    const timeoutMs = parsed && Number.isFinite(parsed) ? parsed : undefined;
    const code = await doctorCommand({ json, offline, timeoutMs });
    if (code !== 0) process.exit(code);
  },
});

export const rootCli = subcommands({
  name: 'proxitor',
  version,
  description:
    'Lightweight proxy for routing CLI requests (claude-code, codex) to OpenRouter',
  cmds: {
    start: startCommand,
    config: configCli,
    doctor: doctorCli,
  },
});
