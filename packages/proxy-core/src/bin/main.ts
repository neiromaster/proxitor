#!/usr/bin/env node
import { binary, run } from 'cmd-ts';
import { startCommand } from './cli.js';

// binary() expects the FULL argv (node path first) — see legacy src/cli.ts:64.
void run(binary(startCommand), process.argv);
