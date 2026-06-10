import * as clack from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import { DEFAULTS, readConfigFile } from '../../config.js';
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
  { configKey: string; ask: (cfg: ReturnType<typeof readConfigFile>) => Promise<unknown> }
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

async function handleFieldChange(
  field: string,
  configPath: string,
  cfg: ReturnType<typeof readConfigFile>,
): Promise<void> {
  const entry = FIELD_MAP[field as Exclude<Field, 'back'>];
  const result = await entry.ask(cfg);
  if (result === null) return;

  setGlobalConfigField(configPath, entry.configKey, result);
  clack.log.success(`${entry.configKey} updated`);
}

export async function connectionMenuCommand(opts?: {
  configPath?: string;
}): Promise<void> {
  const configPath = requireConfigPath(opts?.configPath);

  while (true) {
    const cfg = readConfigFile(configPath);
    showCurrentValues(cfg);

    const field = await clack.select({
      message: 'Change which field?',
      options: fieldOptions(cfg),
    });

    if (isCancel(field) || field === 'back') return;

    await handleFieldChange(field, configPath, cfg);
  }
}
