import { subcommands } from 'cmd-ts';
import { configCli, startCommand } from './cli.js';
import { version } from './version.js';

/** proxitor root CLI (spec §3.3): start | config (T4) | doctor (T6). */
export const rootCli = subcommands({
  name: 'proxitor',
  version,
  description: 'Multi-provider LLM gateway',
  cmds: {
    start: startCommand,
    config: configCli,
  },
});
