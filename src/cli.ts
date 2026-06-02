#!/usr/bin/env node
import { cac } from 'cac'
import { loadConfig } from './config.js'
import { logger } from './logger.js'
import { createProxyServer } from './proxy.js'
import { version } from './version.js'

const cli = cac('proxitor')

cli.version(version).usage('[options]').help()

cli
  .option('-p, --port <port>', 'Proxy server port', { default: 8080 })
  .option('-h, --host <host>', 'Proxy server host', { default: '0.0.0.0' })
  .option('-c, --config <path>', 'Path to config file')
  .option('--openrouter-key <key>', 'OpenRouter API key')
  .option('--verbose', 'Enable verbose logging')

const parsed = cli.parse()

async function main() {
  try {
    const config = await loadConfig({
      configPath: parsed.options.config,
      port: parsed.options.port,
      host: parsed.options.host,
      openrouterKey: parsed.options.openrouterKey,
      verbose: parsed.options.verbose,
    })

    const server = createProxyServer(config)

    server.listen(config.port, config.host, () => {
      logger.ready(`Proxitor proxy listening on ${config.host}:${config.port}`)
      logger.info(`Routing requests to OpenRouter`)
    })
  } catch (error) {
    logger.error('Failed to start proxy:', error)
    process.exit(1)
  }
}

void main()
