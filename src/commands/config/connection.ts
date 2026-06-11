import * as clack from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import { DEFAULTS, readConfigFile } from '../../config.js';
import type { ProxyConfig } from '../../config-schema.js';
import { requireConfigPath, setGlobalConfigField } from './config.js';
import {
  askApiKey,
  askAuthType,
  askBaseUrl,
  askHost,
  askPort,
  maskKey,
} from './prompts.js';

type Field = 'apiKey' | 'port' | 'host' | 'baseUrl' | 'authType' | 'back';

const FIELD_MAP: Record<
  Exclude<Field, 'back'>,
  {
    configKey: keyof ProxyConfig;
    ask: (cfg: ReturnType<typeof readConfigFile>) => Promise<unknown>;
  }
> = {
  apiKey: {
    configKey: 'openrouterKey',
    ask: cfg => askApiKey(cfg.openrouterKey ?? DEFAULTS.openrouterKey),
  },
  port: {
    configKey: 'port',
    ask: cfg => askPort(cfg.port ?? DEFAULTS.port),
  },
  host: {
    configKey: 'host',
    ask: cfg => askHost(cfg.host ?? DEFAULTS.host),
  },
  baseUrl: {
    configKey: 'openrouterBaseUrl',
    ask: cfg => askBaseUrl(cfg.openrouterBaseUrl ?? DEFAULTS.openrouterBaseUrl),
  },
  authType: {
    configKey: 'authType',
    ask: cfg => askAuthType(cfg.authType ?? DEFAULTS.authType),
  },
};

function showCurrentValues(cfg: ReturnType<typeof readConfigFile>): void {
  clack.log.info(`API key:  ${maskKey(cfg.openrouterKey ?? '')}`);
  clack.log.info(`Port:     ${cfg.port ?? DEFAULTS.port}`);
  clack.log.info(`Host:     ${cfg.host ?? DEFAULTS.host}`);
  clack.log.info(`Base URL: ${cfg.openrouterBaseUrl ?? DEFAULTS.openrouterBaseUrl}`);
  clack.log.info(`Auth:     ${cfg.authType ?? DEFAULTS.authType}`);
}

function fieldOptions(cfg: ReturnType<typeof readConfigFile>) {
  return [
    { value: 'apiKey', label: 'API key', hint: maskKey(cfg.openrouterKey ?? '') },
    { value: 'port', label: 'Proxy port', hint: String(cfg.port ?? DEFAULTS.port) },
    { value: 'host', label: 'Listen address', hint: cfg.host ?? DEFAULTS.host },
    { value: 'baseUrl', label: 'Base URL' },
    { value: 'authType', label: 'Auth type', hint: cfg.authType ?? DEFAULTS.authType },
    { value: 'back', label: '← Back' },
  ];
}

export async function handleFieldChange(
  field: string,
  configPath: string,
  cfg: ReturnType<typeof readConfigFile>,
): Promise<{ key: keyof typeof cfg; value: unknown } | null> {
  const entry = FIELD_MAP[field as Exclude<Field, 'back'>];
  if (!entry) return null;
  const result = await entry.ask(cfg);
  if (result === null) return null;

  setGlobalConfigField(configPath, entry.configKey, result);
  clack.log.success(`${entry.configKey} updated`);
  return { key: entry.configKey, value: result };
}

export async function connectionMenuCommand(opts?: {
  configPath?: string;
}): Promise<void> {
  const configPath = requireConfigPath(opts?.configPath);
  const cfg = readConfigFile(configPath);

  while (true) {
    showCurrentValues(cfg);

    const field = await clack.select({
      message: 'Change which field?',
      options: fieldOptions(cfg),
    });

    if (isCancel(field) || field === 'back') return;

    const patch = await handleFieldChange(field, configPath, cfg);
    if (patch) {
      // Mirror the write in-memory instead of re-reading the file
      (cfg as Record<string, unknown>)[patch.key] = patch.value;
    }
  }
}
