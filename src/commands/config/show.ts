import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as clack from '@clack/prompts';
import { DEFAULTS, loadConfig, tryFindConfigFile } from '../../config.js';
import type { ProxyConfig } from '../../config-schema.js';
import { maskKey } from './wizard.js';

type ShowArgs = {
  configPath?: string | undefined;
  openrouterKey?: string | undefined;
  json?: boolean | undefined;
};

const SENSITIVE_KEYS = new Set(['openrouterKey']);
const SEPARATE_KEYS = new Set([
  ...SENSITIVE_KEYS,
  'modelOverrides',
  'provider',
  'headers',
]);

function logResolved(cfg: ProxyConfig, source: string | null): void {
  clack.intro('Resolved configuration');
  if (source) {
    clack.log.info(`Source: ${source}`);
  } else {
    clack.log.info('Source: defaults only');
  }

  // Print all scalar config keys automatically — new fields appear without
  // having to add individual clack.log.info lines.
  for (const [key, value] of Object.entries(cfg)) {
    if (SEPARATE_KEYS.has(key)) continue;
    const label = key.padEnd(20);
    if (value !== undefined && value !== '') {
      clack.log.info(`  ${label} ${value}`);
    }
  }

  // Sensitive / compound fields get special formatting
  clack.log.info(`  ${'openrouterKey'.padEnd(20)} ${maskKey(cfg.openrouterKey)}`);

  if (cfg.provider) {
    clack.log.info(`  ${'provider'.padEnd(20)} ${JSON.stringify(cfg.provider)}`);
  }
  if (cfg.headers && Object.keys(cfg.headers).length > 0) {
    clack.log.info(`  ${'headers'.padEnd(20)} ${JSON.stringify(cfg.headers)}`);
  }
  if (cfg.modelOverrides && Object.keys(cfg.modelOverrides).length > 0) {
    const count = Object.keys(cfg.modelOverrides).length;
    clack.log.info(`  ${'modelOverrides'.padEnd(20)} ${count} model(s)`);
    for (const key of Object.keys(cfg.modelOverrides)) {
      clack.log.info(`    ${key}`);
    }
  }

  clack.outro(`Defaults loaded from schema: ${Object.keys(DEFAULTS).length} keys`);
}

export async function showConfigCommand(args: ShowArgs): Promise<void> {
  // When an explicit path is given, check existence ourselves —
  // tryFindConfigFile throws on missing explicit paths, but the guard below
  // was designed for a null return.
  let discoveredPath: string | null = null;
  if (args.configPath) {
    if (existsSync(args.configPath)) {
      discoveredPath = resolve(args.configPath);
    }
    // else: explicit path missing, fall through to the guard
  } else {
    discoveredPath = tryFindConfigFile();
  }
  const configExists = discoveredPath !== null;

  if (!configExists && !args.openrouterKey) {
    clack.log.warn(
      'No config file and no --openrouter-key — cannot show a complete resolved view.',
    );
    if (args.json) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, error: 'No config available' })}\n`,
      );
      return;
    }
    clack.outro('Run `proxitor config wizard` to create one.');
    return;
  }

  const cfg = await loadConfig({
    configPath: args.configPath,
    noConfig: !configExists && !args.configPath,
    openrouterKey: args.openrouterKey,
  });

  if (args.json) {
    const masked = { ...cfg, openrouterKey: maskKey(cfg.openrouterKey) };
    process.stdout.write(`${JSON.stringify(masked, null, 2)}\n`);
    return;
  }

  logResolved(cfg, discoveredPath);
}
