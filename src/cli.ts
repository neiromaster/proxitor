#!/usr/bin/env node
import {
  command,
  flag,
  number,
  option,
  optional,
  run,
  string,
  subcommands,
} from 'cmd-ts';
import { config as loadDotenv } from 'dotenv';
import { DEFAULTS, loadConfig } from './config.js';
import { logger } from './logger.js';
import { OpenRouterDataClient } from './openrouter/data-client.js';
import { startProxyServer } from './proxy.js';
import { version } from './version.js';

const argv = process.argv.slice(2);
const isInfo =
  argv.includes('--help') ||
  argv.includes('-h') ||
  argv.includes('--version') ||
  argv.includes('-v');
if (!isInfo) loadDotenv();

async function resolveApiKey(
  configPath?: string,
  openrouterKey?: string,
): Promise<string | null> {
  if (openrouterKey) return openrouterKey;
  const envKey = process.env.OPENROUTER_API_KEY;
  if (envKey) return envKey;

  try {
    const cfg = await loadConfig({ configPath });
    if (cfg.openrouterKey) return cfg.openrouterKey;
  } catch {
    // Config not found or invalid — fall through
  }

  logger.error(
    'OpenRouter API key required. Set OPENROUTER_API_KEY, pass --openrouter-key, or add it to config.',
  );
  return null;
}

const configOptionArgs = {
  config: option({
    long: 'config',
    short: 'c',
    type: optional(string),
    description: 'Path to config file',
  }),
  openrouterKey: option({
    long: 'openrouter-key',
    type: optional(string),
    description: 'OpenRouter API key',
  }),
};

const startCommand = command({
  name: 'start',
  description: 'Start proxy server',
  args: {
    port: option({
      long: 'port',
      short: 'p',
      type: number,
      description: 'Proxy server port',
      defaultValue: () => DEFAULTS.port,
      defaultValueIsSerializable: true,
    }),
    host: option({
      long: 'host',
      type: string,
      description: 'Proxy server host',
      defaultValue: () => DEFAULTS.host,
      defaultValueIsSerializable: true,
    }),
    config: option({
      long: 'config',
      short: 'c',
      type: optional(string),
      description: 'Path to config file',
    }),
    noConfig: flag({ long: 'no-config', description: 'Skip config file discovery' }),
    openrouterKey: option({
      long: 'openrouter-key',
      type: optional(string),
      description: 'OpenRouter API key',
    }),
    verbose: flag({ long: 'verbose', description: 'Enable verbose logging' }),
  },
  handler: async args => {
    try {
      const cfg = await loadConfig({
        configPath: args.config ?? undefined,
        noConfig: args.noConfig,
        port: args.port,
        host: args.host,
        openrouterKey: args.openrouterKey ?? undefined,
        verbose: args.verbose,
      });
      startProxyServer(cfg, () => {
        logger.ready(`Proxitor proxy listening on ${cfg.host}:${cfg.port}`);
        logger.info('Routing requests to OpenRouter');
      });
    } catch (error) {
      logger.error('Failed to start proxy:', error);
      process.exit(1);
    }
  },
});

const withClient =
  (fn: (client: OpenRouterDataClient) => Promise<void>) =>
  async (args: { config?: string; openrouterKey?: string }) => {
    const apiKey = await resolveApiKey(
      args.config ?? undefined,
      args.openrouterKey ?? undefined,
    );
    if (!apiKey) return;

    try {
      const cfg = await loadConfig({ configPath: args.config ?? undefined });
      await fn(
        new OpenRouterDataClient({
          openrouterBaseUrl: cfg.openrouterBaseUrl,
          openrouterDataUrl: cfg.openrouterDataUrl,
          apiKey,
          authType: cfg.authType,
          onFallback: (path: string) => {
            let endpoint: string;
            if (path === '/v1/providers') {
              endpoint = 'providers';
            } else if (path === '/v1/models') {
              endpoint = 'models';
            } else {
              endpoint = 'model providers';
            }
            logger.warn(
              `Custom API did not return ${endpoint}, using OpenRouter data as fallback`,
            );
          },
        }),
      );
    } catch (error) {
      logger.error('Failed to load config:', error);
    }
  };

const configCli = subcommands({
  name: 'config',
  description: 'Manage proxy configuration',
  cmds: {
    add: command({
      name: 'add',
      description: 'Add model override',
      args: configOptionArgs,
      handler: withClient(async client =>
        (await import('./commands/config/add.js')).addOverrideCommand(client),
      ),
    }),
    edit: command({
      name: 'edit',
      description: 'Edit model override',
      args: configOptionArgs,
      handler: withClient(async client =>
        (await import('./commands/config/edit.js')).editOverrideCommand(client),
      ),
    }),
    remove: command({
      name: 'remove',
      description: 'Remove model override',
      args: {},
      handler: async () =>
        (await import('./commands/config/remove.js')).removeOverrideCommand(),
    }),
    list: command({
      name: 'list',
      description: 'List current overrides',
      args: {},
      handler: async () =>
        (await import('./commands/config/list.js')).listOverridesCommand(),
    }),
    browse: command({
      name: 'browse',
      description: 'Browse models',
      args: configOptionArgs,
      handler: withClient(async client =>
        (await import('./commands/config/browse.js')).browseModelsCommand(client),
      ),
    }),
    validate: command({
      name: 'validate',
      description: 'Validate config',
      args: {},
      handler: async () =>
        (await import('./commands/config/validate.js')).validateConfigCommand(),
    }),
    menu: command({
      name: 'menu',
      description: 'Interactive configuration menu',
      args: configOptionArgs,
      handler: withClient(async client =>
        (await import('./commands/config.js')).runConfigMenu(client),
      ),
    }),
    wizard: command({
      name: 'wizard',
      description: 'Interactive setup wizard',
      args: {},
      handler: async () => {
        const { runWizard } = await import('./commands/config/wizard.js');
        await runWizard();
      },
    }),
  },
});

const rootCli = subcommands({
  name: 'proxitor',
  version,
  description: 'Lightweight proxy for routing CLI requests to OpenRouter',
  cmds: { start: startCommand, config: configCli },
});

const handleError = async (err: Error) => {
  if (err.message.includes('No config file found') && process.stdin.isTTY) {
    logger.error(err.message);
    const clack = await import('@clack/prompts');
    const launch = await clack.confirm({
      message: 'Run setup wizard?',
      initialValue: true,
    });
    if (clack.isCancel(launch) || !launch) {
      process.exit(1);
    }
    const { runWizard } = await import('./commands/config/wizard.js');
    await runWizard();
    return;
  }
  logger.error(err.message);
  process.exit(1);
};

const hasSubcommand = argv.some(a => !a.startsWith('-'));
if (hasSubcommand || isInfo) {
  void run(rootCli, argv).catch(err => void handleError(err));
} else {
  void run(startCommand, argv).catch(err => void handleError(err));
}
