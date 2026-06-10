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
// We must NOT prepend `start` when a known subcommand appears after flags
// (e.g. `proxitor --offline doctor`). We check the first non-flag argument
// against the known subcommand list — flag values like `9000` or `3.5`
// won't match, so they correctly trigger the default `start` prepend.
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

// When the user only passes info flags (--help, --version) without a
// subcommand, we want root-level help that lists all subcommands — not
// the `start` command's help.  Only prepend `start` for real invocations.
const finalArgv =
  needsDefault && !isInfo
    ? ['node', 'proxitor', 'start', ...userArgs]
    : [...process.argv];

// cmd-ts has no default sub-subcommand, so `proxitor config` without a
// sub-subcommand shows help instead of the interactive menu.  Detect this
// case and inject `menu` after `config`.  Skip when help/version flags are
// present so `proxitor config -h` shows the full config subcommand list.
const configArgs =
  !needsDefault && firstNonFlag === 'config'
    ? userArgs.slice(userArgs.indexOf('config') + 1)
    : [];
const configSub = configArgs.find(a => !a.startsWith('-'));
const configHasInfo = configArgs.some(a =>
  ['--help', '-h', '--version', '-v'].includes(a),
);
if (!needsDefault && firstNonFlag === 'config' && !configHasInfo) {
  if (!configSub || !KNOWN_CONFIG_SUBS.has(configSub)) {
    finalArgv.splice(finalArgv.lastIndexOf('config') + 1, 0, 'menu');
  }
}

void run(binary(rootCli), finalArgv).catch(err => void handleStartupError(err));
