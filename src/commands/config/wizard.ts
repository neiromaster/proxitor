import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import * as clack from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import { parseDocument, stringify } from 'yaml';
import {
  type AuthType,
  DEFAULTS,
  findConfigFile,
  getXdgConfigDir,
  readConfigFile,
} from '../../config.js';

type SaveLocation = 'local' | 'user' | 'xdg';

function maskKey(key: string): string {
  if (key.length <= 11) return '****';
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}

function resolveSavePath(location: SaveLocation): string {
  switch (location) {
    case 'local':
      return resolve('proxitor.config.yaml');
    case 'user':
      return join(homedir(), '.config', 'proxitor', 'config.yaml');
    case 'xdg':
      return join(getXdgConfigDir(), 'config.yaml');
  }
}

function getSaveLocationOptions(_existingPath?: string) {
  const opts: { value: SaveLocation; label: string; hint: string }[] = [
    { value: 'local', label: './proxitor.config.yaml', hint: 'Project directory' },
    { value: 'user', label: '~/.config/proxitor/config.yaml', hint: 'User config' },
  ];

  if (process.env.XDG_CONFIG_HOME) {
    opts.push({
      value: 'xdg',
      label: '$XDG_CONFIG_HOME/proxitor/config.yaml',
      hint: 'XDG config directory',
    });
  }

  return opts;
}

function detectLocation(path: string): SaveLocation | undefined {
  const cwd = resolve('.');
  if (path.startsWith(cwd)) return 'local';
  const userDir = join(homedir(), '.config', 'proxitor');
  if (path.startsWith(userDir)) {
    const xdgDir = process.env.XDG_CONFIG_HOME
      ? join(process.env.XDG_CONFIG_HOME, 'proxitor')
      : null;
    if (xdgDir && path.startsWith(xdgDir)) return 'xdg';
    return 'user';
  }
  return undefined;
}

function buildYaml(
  apiKey: string,
  port: number,
  host: string,
  baseUrl: string,
  authType: string,
  existingRaw?: string,
): string {
  if (existingRaw) {
    const doc = parseDocument(existingRaw);
    doc.set('openrouterKey', apiKey);
    doc.set('port', port);
    doc.set('host', host);
    if (baseUrl !== DEFAULTS.openrouterBaseUrl) {
      doc.set('openrouterBaseUrl', baseUrl);
    } else {
      doc.delete('openrouterBaseUrl');
    }
    if (authType !== DEFAULTS.authType) {
      doc.set('authType', authType);
    } else {
      doc.delete('authType');
    }
    return doc.toString();
  }

  const config: Record<string, unknown> = { openrouterKey: apiKey, port, host };
  if (baseUrl !== DEFAULTS.openrouterBaseUrl) {
    config.openrouterBaseUrl = baseUrl;
  }
  if (authType !== DEFAULTS.authType) {
    config.authType = authType;
  }
  return stringify(config);
}

async function askApiKey(currentKey: string): Promise<string | null> {
  if (currentKey) {
    clack.log.info(`Current key: ${maskKey(currentKey)}`);
  }
  const apiKey = await clack.text({
    message: 'OpenRouter API key',
    placeholder: 'sk-or-v1-...',
    initialValue: currentKey,
    validate: v => {
      if (!v?.trim()) return 'API key is required';
      return undefined;
    },
  });
  if (isCancel(apiKey)) return null;

  clack.note(
    'You can also set the OPENROUTER_API_KEY environment variable\nto avoid storing the key in the config file.',
    'Tip',
  );
  return apiKey as string;
}

async function askPort(current: number): Promise<number | null> {
  const input = await clack.text({
    message: 'Proxy port',
    initialValue: String(current),
    placeholder: String(DEFAULTS.port),
    validate: v => {
      if (!v?.trim()) return undefined;
      const n = Number.parseInt(v, 10);
      if (Number.isNaN(n) || n < 1 || n > 65535) return 'Port must be 1–65535';
      return undefined;
    },
  });
  if (isCancel(input)) return null;
  return (input as string).trim() ? Number.parseInt(input as string, 10) : DEFAULTS.port;
}

async function askBaseUrl(current: string): Promise<string | null> {
  const url = await clack.text({
    message: 'OpenRouter API base URL',
    placeholder: DEFAULTS.openrouterBaseUrl,
    initialValue: current === DEFAULTS.openrouterBaseUrl ? '' : current,
    validate: v => {
      if (!v?.trim()) return undefined;
      try {
        const parsed = new URL(v.trim());
        if (!parsed.protocol.startsWith('http'))
          return 'URL must start with http:// or https://';
      } catch {
        return 'Invalid URL';
      }
      return undefined;
    },
  });
  if (isCancel(url)) return null;
  return (url as string).trim() || DEFAULTS.openrouterBaseUrl;
}

async function askAuthType(current: string): Promise<string | null> {
  const authType = await clack.select({
    message: 'Authentication type',
    initialValue: current,
    options: [
      { value: 'bearer', label: 'Bearer token', hint: 'Standard OpenRouter' },
      { value: 'oauth', label: 'OAuth token', hint: 'Custom proxy providers' },
    ],
  });
  if (isCancel(authType)) return null;
  return authType as string;
}

async function askHost(current: string): Promise<string | null> {
  const host = await clack.select({
    message: 'Listen address',
    initialValue: current as '0.0.0.0' | '127.0.0.1',
    options: [
      { value: '0.0.0.0', label: 'All interfaces (0.0.0.0)', hint: 'Default' },
      { value: '127.0.0.1', label: 'Localhost only (127.0.0.1)', hint: 'More secure' },
    ],
  });
  if (isCancel(host)) return null;
  return host as string;
}

async function askSaveLocation(existingPath?: string): Promise<SaveLocation | null> {
  const options = getSaveLocationOptions(existingPath);
  const detected = existingPath ? detectLocation(existingPath) : undefined;

  const location = await clack.select({
    message: 'Save config to',
    initialValue: detected ?? 'local',
    options,
  });
  if (isCancel(location)) return null;
  return location as SaveLocation;
}

type ExistingConfigState = {
  raw?: string;
  port: number;
  host: string;
  apiKey: string;
  baseUrl: string;
  authType: AuthType;
};

/** Load existing config using validated readConfigFile, falling back to defaults */
function loadExistingConfig(path: string): ExistingConfigState {
  try {
    const fileConfig = readConfigFile(path);
    const raw = readFileSync(path, 'utf-8');
    return {
      raw,
      port: fileConfig.port ?? DEFAULTS.port,
      host: fileConfig.host ?? DEFAULTS.host,
      apiKey: fileConfig.openrouterKey ?? DEFAULTS.openrouterKey,
      baseUrl: fileConfig.openrouterBaseUrl ?? DEFAULTS.openrouterBaseUrl,
      authType: fileConfig.authType ?? DEFAULTS.authType,
    };
  } catch {
    return {
      raw: undefined,
      port: DEFAULTS.port,
      host: DEFAULTS.host,
      apiKey: DEFAULTS.openrouterKey,
      baseUrl: DEFAULTS.openrouterBaseUrl,
      authType: DEFAULTS.authType,
    };
  }
}

export async function runWizard(): Promise<void> {
  clack.intro('Proxitor Setup Wizard');

  const existingPath = findConfigFile();
  let existingRaw: string | undefined;
  let currentPort = DEFAULTS.port;
  let currentHost = DEFAULTS.host;
  let currentKey = DEFAULTS.openrouterKey;
  let currentBaseUrl = DEFAULTS.openrouterBaseUrl;
  let currentAuthType = DEFAULTS.authType;

  if (existingPath) {
    clack.note(existingPath, 'Existing config found');

    const reconfigure = await clack.confirm({
      message: 'Reconfigure?',
      initialValue: true,
    });
    if (isCancel(reconfigure) || !reconfigure) {
      clack.outro('Using existing configuration');
      return;
    }

    const existing = loadExistingConfig(existingPath);
    existingRaw = existing.raw;
    currentPort = existing.port;
    currentHost = existing.host;
    currentKey = existing.apiKey;
    currentBaseUrl = existing.baseUrl;
    currentAuthType = existing.authType;
  }

  const apiKey = await askApiKey(currentKey);
  if (apiKey === null) {
    clack.outro('Cancelled');
    return;
  }

  const port = await askPort(currentPort);
  if (port === null) {
    clack.outro('Cancelled');
    return;
  }

  const baseUrl = await askBaseUrl(currentBaseUrl);
  if (baseUrl === null) {
    clack.outro('Cancelled');
    return;
  }

  const authType = await askAuthType(currentAuthType);
  if (authType === null) {
    clack.outro('Cancelled');
    return;
  }

  const host = await askHost(currentHost);
  if (host === null) {
    clack.outro('Cancelled');
    return;
  }

  const location = await askSaveLocation(existingPath ?? undefined);
  if (location === null) {
    clack.outro('Cancelled');
    return;
  }

  const yaml = buildYaml(apiKey, port, host, baseUrl, authType, existingRaw);
  clack.note(yaml, 'Preview');

  const save = await clack.confirm({
    message: 'Save this configuration?',
    initialValue: true,
  });
  if (isCancel(save) || !save) {
    clack.outro('Cancelled — no files written');
    return;
  }

  const savePath = resolveSavePath(location);
  const dir = dirname(savePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(savePath, yaml, 'utf-8');

  clack.outro(`Config saved to ${savePath}`);
}
