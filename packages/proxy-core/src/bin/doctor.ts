// src/bin/doctor.ts

import { createServer } from 'node:net';
import type { LoggerPort } from '@proxitor/plugin-api';
import { createConfigFile } from '../adapters/config-file.js';
import { validateActivation } from '../application/activation-check.js';
import { type ProxyConfig, parseConfig } from '../application/config-schema.js';
import { createPluginManager } from '../application/plugin-manager.js';
import { createRoutingTable } from '../domain/index.js';
import { createBuiltInPluginRegistry } from '../plugins/built-in/index.js';

export type DoctorCheck = {
  readonly name: string;
  readonly status: 'ok' | 'warn' | 'fail' | 'skip';
  readonly detail?: string;
};

export type DoctorReport = {
  readonly checks: readonly DoctorCheck[];
  readonly exitCode: 0 | 1;
};

export type DoctorIo = {
  readonly env: Record<string, string | undefined>;
  readonly readFile: (path: string) => Promise<string>;
  readonly stat: (path: string) => Promise<{ mode: number }>;
  readonly bindProbe: (
    host: string,
    port: number,
  ) => Promise<{ ok: boolean; detail?: string } | 'skip'>;
};

const SILENT_LOGGER: LoggerPort = { info() {}, warn() {}, error() {}, debug() {} };

/** Real port probe: bind+close on the exact host:port; 'skip' never returned. */
export function createNetBindProbe(): DoctorIo['bindProbe'] {
  return (host, port) =>
    new Promise(resolve => {
      const server = createServer();
      server.once('error', error => {
        server.close(() => resolve({ ok: false, detail: error.message }));
      });
      server.listen(port, host, () => {
        server.close(() => resolve({ ok: true }));
      });
    });
}

type CredentialRef = ProxyConfig['providers'][string]['auth']['credential'];

/** Per-provider credential probe. Mirrors adapters/credentials.ts semantics. */
async function inspectCredential(
  ref: CredentialRef,
  io: DoctorIo,
): Promise<{ status: 'ok' | 'fail'; detail: string }> {
  if (typeof ref === 'string') return { status: 'ok', detail: 'literal credential' };
  if ('env' in ref) {
    const value = io.env[ref.env];
    const set = value !== undefined && value.length > 0;
    return set
      ? { status: 'ok', detail: `env ${ref.env}` }
      : { status: 'fail', detail: `env "${ref.env}" is not set` };
  }
  try {
    const { mode } = await io.stat(ref.file);
    if ((mode & 0o777) !== 0o600) {
      return {
        status: 'fail',
        detail: `file "${ref.file}" permissions 0${(mode & 0o777).toString(8)}, expected 0600`,
      };
    }
  } catch {
    return { status: 'fail', detail: `file "${ref.file}" not found` };
  }
  const content = await io.readFile(ref.file);
  if (content.trim().length === 0) {
    return { status: 'fail', detail: `file "${ref.file}" is empty` };
  }
  return { status: 'ok', detail: `file ${ref.file} (0600)` };
}

function skipDependentChecks(checks: DoctorCheck[]): void {
  checks.push(
    { name: 'routing-table', status: 'skip' },
    { name: 'activation', status: 'skip' },
    { name: 'port-bind', status: 'skip' },
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function checkConfig(
  options: { configPath?: string },
  io: DoctorIo,
): Promise<{ checks: DoctorCheck[]; config: ProxyConfig | undefined }> {
  const checks: DoctorCheck[] = [];
  const files = createConfigFile({ env: io.env, readFile: io.readFile });
  let config: ProxyConfig | undefined;

  try {
    const source = await files.findAndRead(options.configPath);
    checks.push({ name: 'config-found', status: 'ok', detail: source.path });
    try {
      config = parseConfig(files.parse(source.text, source.path));
      checks.push({ name: 'config-valid', status: 'ok' });
    } catch (error) {
      checks.push({
        name: 'config-valid',
        status: 'fail',
        detail: formatError(error),
      });
    }
  } catch (error) {
    checks.push({
      name: 'config-found',
      status: 'fail',
      detail: formatError(error),
    });
    checks.push({ name: 'config-valid', status: 'skip' });
    skipDependentChecks(checks);
    return { checks, config: undefined };
  }

  return { checks, config };
}

async function checkCredentials(
  config: ProxyConfig,
  io: DoctorIo,
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  for (const [name, provider] of Object.entries(config.providers)) {
    checks.push({
      name: `credential:${name}`,
      ...(await inspectCredential(provider.auth.credential, io)),
    });
  }
  return checks;
}

function checkRouting(config: ProxyConfig): DoctorCheck {
  try {
    createRoutingTable({
      providers: config.providers,
      models: config.models,
      plugins: config.plugins,
      defaultProvider: config.defaultProvider,
    });
    return {
      name: 'routing-table',
      status: 'ok',
      detail: config.models
        .map(binding => `${binding.match} → ${binding.provider} / ${binding.modelId}`)
        .join('\n'),
    };
  } catch (error) {
    return {
      name: 'routing-table',
      status: 'fail',
      detail: formatError(error),
    };
  }
}

function checkActivation(config: ProxyConfig): DoctorCheck {
  try {
    const manager = createPluginManager({
      plugins: createBuiltInPluginRegistry(),
      logger: SILENT_LOGGER,
    });
    validateActivation(config, manager);
    return { name: 'activation', status: 'ok' };
  } catch (error) {
    return {
      name: 'activation',
      status: 'fail',
      detail: formatError(error),
    };
  }
}

async function checkPort(config: ProxyConfig, io: DoctorIo): Promise<DoctorCheck> {
  const host = config.server.host;
  const port = config.server.port;
  const probe = await io.bindProbe(host, port);
  if (probe === 'skip') return { name: 'port-bind', status: 'skip' };
  return probe.ok
    ? { name: 'port-bind', status: 'ok', detail: `${host}:${port} free` }
    : {
        name: 'port-bind',
        status: 'warn',
        detail: probe.detail ?? `${host}:${port} in use`,
      };
}

export async function runDoctor(
  options: { configPath?: string },
  io: DoctorIo,
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  const { checks: configChecks, config } = await checkConfig(options, io);
  checks.push(...configChecks);

  if (config === undefined) {
    skipDependentChecks(checks);
    return finish(checks);
  }

  checks.push(...(await checkCredentials(config, io)));
  checks.push(checkRouting(config));
  checks.push(checkActivation(config));
  checks.push(await checkPort(config, io));

  return finish(checks);
}

function finish(checks: DoctorCheck[]): DoctorReport {
  return { checks, exitCode: checks.some(check => check.status === 'fail') ? 1 : 0 };
}

const MARKS: Record<DoctorCheck['status'], string> = {
  ok: '✓',
  warn: '⚠',
  fail: '✗',
  skip: '-',
};

export function renderText(report: DoctorReport): string {
  return report.checks
    .map(check => {
      const mark = MARKS[check.status];
      return check.detail === undefined
        ? `${mark} ${check.name}`
        : `${mark} ${check.name} — ${check.detail}`;
    })
    .join('\n');
}

export function renderJson(report: DoctorReport): string {
  return JSON.stringify(report, null, 2);
}
