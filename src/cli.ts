#!/usr/bin/env node
import { binary, run } from 'cmd-ts';
import { config as loadDotenv } from 'dotenv';
import { rootCli } from './cli-commands.js';
import { runWizard } from './commands/config/wizard.js';
import { MissingConfigError } from './config-schema.js';
import { logger } from './logger.js';

const INFO_FLAGS = ['--help', '-h', '--version', '-v'];

const userArgs = process.argv.slice(2);
const isInfo = userArgs.some(a => INFO_FLAGS.includes(a));
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

// cmd-ts has no default subcommand — prepend "start" when args contain no known subcommand.
const KNOWN_SUBCOMMANDS = new Set(['start', 'up', 'run', 'config', 'doctor']);
const KNOWN_CONFIG_SUBS = new Set([
  'add',
  'edit',
  'remove',
  'list',
  'browse',
  'validate',
  'show',
  'wizard',
  'menu',
]);

const firstNonFlag = userArgs.find(a => !a.startsWith('-'));
const needsDefault =
  userArgs.length === 0 || !firstNonFlag || !KNOWN_SUBCOMMANDS.has(firstNonFlag);

const finalArgv =
  needsDefault && !isInfo ? ['node', 'proxitor', 'start', ...userArgs] : process.argv;

// Inject `menu` as default config subcommand — `proxitor config` → `proxitor config menu`.
if (!needsDefault && firstNonFlag === 'config') {
  const configArgs = userArgs.slice(userArgs.indexOf('config') + 1);
  const configSub = configArgs.find(a => !a.startsWith('-'));
  const configHasInfo = configArgs.some(a => INFO_FLAGS.includes(a));
  if (!configHasInfo && (!configSub || !KNOWN_CONFIG_SUBS.has(configSub))) {
    finalArgv.splice(finalArgv.lastIndexOf('config') + 1, 0, 'menu');
  }
}

void run(binary(rootCli), finalArgv).catch(err => void handleStartupError(err));
