import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import * as clack from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import { parseDocument, stringify } from 'yaml';
import {
  type AuthType,
  DEFAULTS,
  getXdgConfigDir,
  readConfigFile,
  tryFindConfigFile,
} from '../../config.js';
import { probeUpstream } from '../../openrouter/data-client.js';
import {
  AUTH_OPTIONS,
  askApiKey,
  askAuthType,
  askBaseUrl,
  askHost,
  askPort,
} from './prompts.js';

type SaveLocation = 'local' | 'user' | 'xdg';

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
  const cwd = resolve('.') + sep;
  if (path.startsWith(cwd)) return 'local';
  const userDir = join(homedir(), '.config', 'proxitor') + sep;
  if (path.startsWith(userDir)) {
    const xdgDir = process.env.XDG_CONFIG_HOME
      ? join(process.env.XDG_CONFIG_HOME, 'proxitor') + sep
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

/** Preview header — URL and auth are shown even when `buildYaml` omits defaults. */
export function formatPreviewHeader(baseUrl: string, authType: string): string {
  const label = AUTH_OPTIONS.find(o => o.value === authType)?.label ?? authType;
  return `Base URL:  ${baseUrl}\nAuth:      ${label}`;
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
    return loadDefaultState();
  }
}

function loadDefaultState(): ExistingConfigState {
  return {
    raw: undefined,
    port: DEFAULTS.port,
    host: DEFAULTS.host,
    apiKey: DEFAULTS.openrouterKey,
    baseUrl: DEFAULTS.openrouterBaseUrl,
    authType: DEFAULTS.authType,
  };
}

class WizardCancelled extends Error {}

function expectValue<T>(value: T | null, label = 'Cancelled'): T {
  if (value === null) throw new WizardCancelled(label);
  return value;
}

const TOTAL_STEPS = 6;

async function collectAnswers(current: ExistingConfigState): Promise<{
  apiKey: string;
  port: number;
  host: string;
  baseUrl: string;
  authType: string;
}> {
  clack.log.step(`Step 1/${TOTAL_STEPS}: API key`);
  const apiKey = expectValue(await askApiKey(current.apiKey));

  clack.log.step(`Step 2/${TOTAL_STEPS}: Proxy port`);
  const port = expectValue(await askPort(current.port));

  clack.log.step(`Step 3/${TOTAL_STEPS}: Listen address`);
  const host = expectValue(await askHost(current.host));

  clack.log.step(`Step 4/${TOTAL_STEPS}: Base URL`);
  const baseUrl = expectValue(await askBaseUrl(current.baseUrl));

  clack.log.step(`Step 5/${TOTAL_STEPS}: Authentication type`);
  const authType = expectValue(await askAuthType(current.authType));

  // Best-effort upstream probe — non-blocking
  if (apiKey) {
    clack.log.step('Testing upstream connection…');
    const probe = await probeUpstream(baseUrl, apiKey, authType as AuthType);
    if (probe.ok) {
      clack.log.success(`Upstream reachable (${probe.modelCount} models)`);
    } else {
      clack.log.warn(
        `Upstream unreachable: ${probe.reason} — config will still be saved.`,
      );
    }
  }

  return { apiKey, port, host, baseUrl, authType };
}

export async function runWizard(opts: { configPath?: string } = {}): Promise<void> {
  clack.intro('Proxitor Setup Wizard');

  const existingPath = tryFindConfigFile(opts.configPath);
  let existingRaw: string | undefined;
  let current = loadDefaultState();

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
    current = existing;
  }

  try {
    const answers = await collectAnswers(current);

    clack.log.step(`Step ${TOTAL_STEPS}/${TOTAL_STEPS}: Save location`);
    const location = expectValue(await askSaveLocation(existingPath ?? opts.configPath));

    const yaml = buildYaml(
      answers.apiKey,
      answers.port,
      answers.host,
      answers.baseUrl,
      answers.authType,
      existingRaw,
    );
    clack.note(
      `${formatPreviewHeader(answers.baseUrl, answers.authType)}\n${yaml}`,
      'Preview',
    );

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
  } catch (e) {
    if (e instanceof WizardCancelled) {
      clack.outro('Cancelled');
      return;
    }
    throw e;
  }
}
