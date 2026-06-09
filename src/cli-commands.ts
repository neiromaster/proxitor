/**
 * Command tree for the proxitor CLI.
 *
 * Kept in a separate module from `cli.ts` so tests can import the commands
 * without triggering the top-level `run()` invocation that `cli.ts` performs
 * on import.
 */
import { command, flag, option, string, subcommands } from 'cmd-ts';
import { ConfigPath, OpenRouterKey, Port } from './cli-types.js';
import { addOverrideCommand } from './commands/config/add.js';
import { browseModelsCommand } from './commands/config/browse.js';
import { editOverrideCommand } from './commands/config/edit.js';
import { listOverridesCommand } from './commands/config/list.js';
import { removeOverrideCommand } from './commands/config/remove.js';
import { showConfigCommand } from './commands/config/show.js';
import { validateConfigCommand } from './commands/config/validate.js';
import { runWizard } from './commands/config/wizard.js';
import { runConfigMenu } from './commands/config.js';
import { doctorCommand } from './commands/doctor.js';
import { DEFAULTS, loadConfig } from './config.js';
import { logger } from './logger.js';
import { OpenRouterDataClient } from './openrouter/data-client.js';
import { startProxyServer } from './proxy.js';
import { version } from './version.js';

/** Flags that every command touching the config file accepts. */
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

/** `--json` flag for commands that can produce structured output. */
export const jsonFlag = {
  json: flag({
    long: 'json',
    description: 'Output as JSON instead of formatted text',
  }),
} as const;

/** Build an OpenRouterDataClient from already-parsed args. */
export async function makeClient(args: {
  openrouterKey?: string | undefined;
  configPath?: string | undefined;
}): Promise<OpenRouterDataClient> {
  const cfg = await loadConfig({
    configPath: args.configPath ?? undefined,
    openrouterKey: args.openrouterKey ?? undefined,
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

// --- start ---

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
      const cfg = await loadConfig({
        configPath: configPath ?? undefined,
        noConfig,
        port,
        host,
        openrouterKey: openrouterKey ?? undefined,
        verbose,
      });
      startProxyServer(cfg, () => {
        logger.ready(`Proxitor proxy listening on ${cfg.host}:${cfg.port}`);
        logger.info('Routing requests to OpenRouter');
      });
    } catch (error) {
      logger.error('Failed to start proxy:', error);
      throw error;
    }
  },
});

// --- config subcommands ---

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
        await addOverrideCommand({ client });
      },
    }),
    edit: command({
      name: 'edit',
      description: 'Edit an existing model override (interactive)',
      args: { ...configArgs },
      handler: async args => {
        const client = await makeClient(args);
        await editOverrideCommand(client);
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

// --- root ---

export const doctorCli = command({
  name: 'doctor',
  description: 'Diagnose environment and configuration',
  examples: [
    { description: 'Run all checks', command: 'proxitor doctor' },
    { description: 'Skip network checks', command: 'proxitor doctor --offline' },
    { description: 'Output as JSON', command: 'proxitor doctor --json' },
  ],
  args: {
    json: flag({ long: 'json', description: 'Output as JSON instead of formatted text' }),
    offline: flag({
      long: 'offline',
      description: 'Skip network checks (upstream, npm)',
    }),
    timeout: option({
      long: 'timeout',
      short: 't',
      type: string,
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
