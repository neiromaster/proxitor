#!/usr/bin/env node
import { cac } from 'cac'
import { config as loadDotenv } from 'dotenv'
import { loadConfig } from './config.js'
import { logger } from './logger.js'
import { startProxyServer } from './proxy.js'
import { version } from './version.js'

loadDotenv()

const cli = cac('proxitor')

cli.version(version).usage('[options]').help()

cli
  .option('-p, --port <port>', 'Proxy server port', { default: 8080 })
  .option('-h, --host <host>', 'Proxy server host', { default: '0.0.0.0' })
  .option('-c, --config <path>', 'Path to config file')
  .option('--no-config', 'Skip config file discovery')
  .option('--openrouter-key <key>', 'OpenRouter API key')
  .option('--verbose', 'Enable verbose logging')

const parsed = cli.parse()
const firstArg = parsed.args[0]

if (firstArg === 'config') {
  // cac doesn't support nested subcommands — route manually
  void runConfig(parsed.args[1], parsed.options)
} else if (!firstArg) {
  void main()
} else {
  cli.outputHelp()
}

type ConfigAction = 'add' | 'edit' | 'remove' | 'list' | 'browse' | 'validate' | 'menu'

async function runConfig(
  subcommand: string | undefined,
  options: Record<string, unknown>,
): Promise<void> {
  const apiKey = await resolveApiKey(options)
  if (!apiKey) return

  const action: ConfigAction = (subcommand as ConfigAction) || 'menu'

  switch (action) {
    case 'add': {
      const { addOverrideCommand } = await import('./commands/config/add.js')
      await addOverrideCommand(apiKey)
      break
    }
    case 'edit': {
      const { editOverrideCommand } = await import('./commands/config/edit.js')
      await editOverrideCommand(apiKey)
      break
    }
    case 'remove': {
      const { removeOverrideCommand } = await import('./commands/config/remove.js')
      await removeOverrideCommand()
      break
    }
    case 'list': {
      const { listOverridesCommand } = await import('./commands/config/list.js')
      await listOverridesCommand()
      break
    }
    case 'browse': {
      const { browseModelsCommand } = await import('./commands/config/browse.js')
      await browseModelsCommand(apiKey)
      break
    }
    case 'validate': {
      const { validateConfigCommand } = await import('./commands/config/validate.js')
      await validateConfigCommand()
      break
    }
    default: {
      const { runConfigMenu } = await import('./commands/config.js')
      await runConfigMenu(apiKey)
      break
    }
  }
}

async function resolveApiKey(options: Record<string, unknown>): Promise<string | null> {
  if (options.openRouterKey && typeof options.openRouterKey === 'string') {
    return options.openRouterKey
  }

  const envKey = process.env.OPENROUTER_API_KEY
  if (envKey) return envKey

  try {
    const config = await loadConfig({
      configPath: typeof options.config === 'string' ? options.config : undefined,
    })
    if (config.openrouterKey) return config.openrouterKey
  } catch {
    // Config not found or invalid — fall through
  }

  logger.error(
    'OpenRouter API key required. Set OPENROUTER_API_KEY, pass --openrouter-key, or add it to config.',
  )
  return null
}

async function main() {
  try {
    const config = await loadConfig({
      configPath:
        typeof parsed.options.config === 'string' ? parsed.options.config : undefined,
      noConfig: parsed.options.config === false,
      port: parsed.options.port,
      host: parsed.options.host,
      openrouterKey: parsed.options.openrouterKey,
      verbose: parsed.options.verbose,
    })

    startProxyServer(config, () => {
      logger.ready(`Proxitor proxy listening on ${config.host}:${config.port}`)
      logger.info('Routing requests to OpenRouter')
    })
  } catch (error) {
    logger.error('Failed to start proxy:', error)
    process.exit(1)
  }
}
