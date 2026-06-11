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

/** Map field name → config key + prompt function. */
const FIELD_MAP: Record<
  string,
  {
    configKey: keyof ProxyConfig;
    ask: (cfg: ReturnType<typeof readConfigFile>) => Promise<unknown>;
    label: string;
  }
> = {
  apiKey: {
    configKey: 'openrouterKey',
    label: 'API key',
    ask: cfg => askApiKey(cfg.openrouterKey ?? DEFAULTS.openrouterKey),
  },
  port: {
    configKey: 'port',
    label: 'Proxy port',
    ask: cfg => askPort(cfg.port ?? DEFAULTS.port),
  },
  host: {
    configKey: 'host',
    label: 'Listen address',
    ask: cfg => askHost(cfg.host ?? DEFAULTS.host),
  },
  baseUrl: {
    configKey: 'openrouterBaseUrl',
    label: 'Base URL',
    ask: cfg => askBaseUrl(cfg.openrouterBaseUrl ?? DEFAULTS.openrouterBaseUrl),
  },
  authType: {
    configKey: 'authType',
    label: 'Auth type',
    ask: cfg => askAuthType(cfg.authType ?? DEFAULTS.authType),
  },
};

export async function connectionMenuCommand(opts?: {
  configPath?: string;
}): Promise<void> {
  const configPath = requireConfigPath(opts?.configPath);
  const cfg = readConfigFile(configPath);

  const field = await clack.select({
    message: 'Change which field?',
    options: [
      { value: 'apiKey', label: 'API key', hint: maskKey(cfg.openrouterKey ?? '') },
      { value: 'port', label: 'Proxy port', hint: String(cfg.port ?? DEFAULTS.port) },
      { value: 'host', label: 'Listen address', hint: cfg.host ?? DEFAULTS.host },
      { value: 'baseUrl', label: 'Base URL' },
      { value: 'authType', label: 'Auth type', hint: cfg.authType ?? DEFAULTS.authType },
      { value: 'back', label: '← Back' },
    ],
  });

  if (isCancel(field) || field === 'back') return;

  const entry = FIELD_MAP[field as string];
  if (!entry) return;

  const result = await entry.ask(cfg);
  if (result === null) return;

  setGlobalConfigField(configPath, entry.configKey, result);
  clack.log.success(`${entry.label} updated`);
}
