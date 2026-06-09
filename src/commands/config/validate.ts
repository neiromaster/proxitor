import * as clack from '@clack/prompts';
import { readConfigFile, tryFindConfigFile } from '../../config.js';

/** Run config validation and display results. */
export async function validateConfigCommand(): Promise<void> {
  clack.intro('Validate Config');

  const configPath = tryFindConfigFile();
  if (!configPath) {
    clack.log.warn('No config file found — nothing to validate.');
    clack.outro('Run `proxitor config wizard` to create one.');
    return;
  }

  clack.log.info(`Checking ${configPath}...`);

  try {
    readConfigFile(configPath);
    clack.log.success('Config is valid ✓');
  } catch (error) {
    clack.log.error(String(error));
  }

  clack.outro('');
}
