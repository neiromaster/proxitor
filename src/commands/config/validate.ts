import * as clack from '@clack/prompts'
import { findConfigFile, readConfigFile } from '../../config.js'

/** Run config validation and display results. */
export async function validateConfigCommand(): Promise<void> {
  clack.intro('Validate Config')

  const configPath = findConfigFile()
  if (!configPath) {
    clack.log.error('No config file found.')
    clack.outro('')
    return
  }

  clack.log.info(`Checking ${configPath}...`)

  try {
    readConfigFile(configPath)
    clack.log.success('Config is valid ✓')
  } catch (error) {
    clack.log.error(String(error))
  }

  clack.outro('')
}
