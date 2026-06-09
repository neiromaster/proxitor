import { existsSync } from 'node:fs';
import * as clack from '@clack/prompts';
import { DEFAULTS, loadConfig, tryFindConfigFile } from '../../config.js';
import type { ProxyConfig } from '../../config-schema.js';

/** Mask an API key for display. */
function maskKey(key: string): string {
  if (!key) return '(none)';
  if (key.length < 16) return `${key.slice(0, 4)}...${key.slice(-2)}`;
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}

type ShowArgs = {
  configPath?: string | undefined;
  openrouterKey?: string | undefined;
  json?: boolean | undefined;
};

function logResolved(cfg: ProxyConfig, source: string | null): void {
  clack.intro('Resolved configuration');
  if (source) {
    clack.log.info(`Source: ${source}`);
  } else {
    clack.log.info('Source: defaults only');
  }
  clack.log.info(`  host:                ${cfg.host}`);
  clack.log.info(`  port:                ${cfg.port}`);
  clack.log.info(`  openrouterBaseUrl:   ${cfg.openrouterBaseUrl}`);
  if (cfg.openrouterDataUrl) {
    clack.log.info(`  openrouterDataUrl:   ${cfg.openrouterDataUrl}`);
  }
  clack.log.info(`  openrouterKey:       ${maskKey(cfg.openrouterKey)}`);
  clack.log.info(`  authType:            ${cfg.authType}`);
  clack.log.info(`  verbose:             ${cfg.verbose}`);
  clack.log.info(`  bodyLimit:           ${cfg.bodyLimit}`);
  clack.log.info(`  cacheControl:        ${cfg.cacheControl}`);
  if (cfg.cacheControlTtl) {
    clack.log.info(`  cacheControlTtl:     ${cfg.cacheControlTtl}`);
  }
  clack.log.info(`  sessionId:           ${cfg.sessionId}`);
  clack.log.info(`  attributionReferer:  ${cfg.attributionReferer}`);
  clack.log.info(`  attributionTitle:    ${cfg.attributionTitle}`);

  if (cfg.provider) {
    clack.log.info(`  provider:            ${JSON.stringify(cfg.provider)}`);
  }
  if (cfg.headers && Object.keys(cfg.headers).length > 0) {
    clack.log.info(`  headers:             ${JSON.stringify(cfg.headers)}`);
  }
  if (cfg.modelOverrides && Object.keys(cfg.modelOverrides).length > 0) {
    const count = Object.keys(cfg.modelOverrides).length;
    clack.log.info(`  modelOverrides:      ${count} model(s)`);
    for (const key of Object.keys(cfg.modelOverrides)) {
      clack.log.info(`    ${key}`);
    }
  }
  clack.outro(`Defaults loaded from schema: ${Object.keys(DEFAULTS).length} keys`);
}

/** Show the resolved configuration (defaults + file + env + flags merged). */
export async function showConfigCommand(args: ShowArgs): Promise<void> {
  const discoveredPath = tryFindConfigFile(args.configPath);
  const configExists = discoveredPath !== null && existsSync(discoveredPath);

  if (!configExists && !args.openrouterKey) {
    clack.log.warn(
      'No config file and no --openrouter-key — cannot show a complete resolved view.',
    );
    if (!args.json) {
      clack.outro('Run `proxitor config wizard` to create one.');
      return;
    }
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
