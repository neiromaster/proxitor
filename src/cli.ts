#!/usr/bin/env node
import { binary, run } from 'cmd-ts';
import { config as loadDotenv } from 'dotenv';
import { rootCli } from './cli-commands.js';
import { runWizard } from './commands/config/wizard.js';
import { MissingConfigError } from './config-schema.js';
import { logger } from './logger.js';

// Skip .env loading for info-only invocations (--help, --version).
const userArgs = process.argv.slice(2);
const isInfo =
  userArgs.includes('--help') ||
  userArgs.includes('-h') ||
  userArgs.includes('--version') ||
  userArgs.includes('-v');
if (!isInfo) loadDotenv({ quiet: true });

async function handleStartupError(err: Error): Promise<void> {
  if (err instanceof MissingConfigError && process.stdin.isTTY) {
    logger.error(err.message);
    const clack = await import('@clack/prompts');
    const launch = await clack.confirm({
      message: 'Run setup wizard?',
      initialValue: true,
    });
    if (clack.isCancel(launch) || !launch) {
      process.exit(1);
    }
    await runWizard({});
    return;
  }
  logger.error(err.message);
  process.exit(1);
}

// `binary()` strips the node executable path and reuses the script name as
// the binary name in help output, so we can pass process.argv untouched.
// cmd-ts has no built-in default subcommand, so we prepend "start" when
// the user gave us only flags (or nothing) so `proxitor --port 9000`
// behaves like `proxitor start --port 9000`.
const finalArgv =
  userArgs.length === 0 || userArgs[0]?.startsWith('-')
    ? ['node', 'proxitor', 'start', ...userArgs]
    : process.argv;

void run(binary(rootCli), finalArgv).catch(err => void handleStartupError(err));
