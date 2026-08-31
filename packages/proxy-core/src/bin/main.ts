#!/usr/bin/env node
import { binary, run } from 'cmd-ts';
import { rootCli } from './root-cli.js';

void run(binary(rootCli), process.argv);
