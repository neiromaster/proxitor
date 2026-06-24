import { createServer } from 'node:net';
import * as clack from '@clack/prompts';
import {
  DEFAULTS,
  detectSlugCollisions,
  formatSlugCollisionWarning,
  getConfigSearchPaths,
  readConfigFile,
  tryFindConfigFile,
} from '../config.js';
import type { ProxyConfig } from '../config-schema.js';
import { probeUpstream } from '../openrouter/data-client.js';
import { version } from '../version.js';

type Status = 'ok' | 'warn' | 'fail' | 'skip';

type Check = {
  name: string;
  status: Status;
  message?: string;
  value?: string;
  [k: string]: unknown;
};

type DoctorOptions = {
  json?: boolean | undefined;
  offline?: boolean | undefined;
  timeoutMs?: number | undefined;
};

const DEFAULT_TIMEOUT_MS = 3_000;
const REQUIRED_NODE_MAJOR = 22;

function checkNodeVersion(): Check {
  const v = process.versions.node;
  const major = Number.parseInt(v.split('.')[0] ?? '0', 10);
  if (Number.isNaN(major) || major < REQUIRED_NODE_MAJOR) {
    return {
      name: 'node-version',
      status: 'fail',
      message: `Node.js ${v} is older than required ${REQUIRED_NODE_MAJOR}`,
      value: v,
    };
  }
  return { name: 'node-version', status: 'ok', value: v };
}

function checkPlatform(): Check {
  return {
    name: 'platform',
    status: 'ok',
    value: `${process.platform} ${process.arch}`,
  };
}

function checkTty(): Check {
  return {
    name: 'tty',
    status: process.stdout.isTTY ? 'ok' : 'warn',
    message: process.stdout.isTTY
      ? undefined
      : 'Not running in a TTY — interactive prompts will be limited',
    value: String(process.stdout.isTTY),
  };
}

function checkConfigDiscovery(): Check {
  const path = tryFindConfigFile();
  if (path) {
    return { name: 'config-found', status: 'ok', path };
  }
  return {
    name: 'config-found',
    status: 'fail',
    message: 'No config file found',
    searched: getConfigSearchPaths(),
  };
}

function checkConfigValidity(path: string | null): {
  check: Check;
  config: ProxyConfig | null;
} {
  if (!path) {
    return {
      check: { name: 'config-valid', status: 'skip', reason: 'no config file' },
      config: null,
    };
  }
  try {
    const cfg = readConfigFile(path);
    const fullCfg = { ...DEFAULTS, ...cfg } as ProxyConfig;
    const overrideCount = cfg.modelOverrides ? Object.keys(cfg.modelOverrides).length : 0;
    return {
      check: {
        name: 'config-valid',
        status: 'ok',
        path,
        keyCount: Object.keys(cfg).length,
        overrideCount,
      },
      config: fullCfg,
    };
  } catch (error) {
    return {
      check: {
        name: 'config-valid',
        status: 'fail',
        path,
        message: error instanceof Error ? error.message : String(error),
      },
      config: null,
    };
  }
}

function checkSlugCollisions(cfg: ProxyConfig | null): Check {
  if (!cfg?.modelOverrides) {
    return { name: 'override-collisions', status: 'ok', message: 'no model overrides' };
  }
  const collisions = detectSlugCollisions(cfg.modelOverrides);
  if (collisions.length === 0) {
    return { name: 'override-collisions', status: 'ok', message: 'no slug collisions' };
  }
  return {
    name: 'override-collisions',
    status: 'warn',
    message: collisions.map(formatSlugCollisionWarning).join(' | '),
  };
}

function checkApiKey(cfg: ProxyConfig | null): Check {
  const fromEnv = process.env.OPENROUTER_API_KEY ? 'set' : 'not set';
  const fromFile = cfg?.openrouterKey ? 'set' : 'not set';
  const resolved = !!(process.env.OPENROUTER_API_KEY || cfg?.openrouterKey);
  return {
    name: 'api-key',
    status: resolved ? 'ok' : 'fail',
    message: resolved
      ? undefined
      : 'Set OPENROUTER_API_KEY, pass --openrouter-key, or add it to config',
    fromEnv,
    fromFile,
  };
}

async function checkUpstream(
  cfg: ProxyConfig | null,
  timeoutMs: number,
  offline: boolean,
): Promise<Check> {
  if (offline) {
    return { name: 'upstream', status: 'skip', reason: 'offline mode' };
  }
  if (!cfg?.openrouterBaseUrl) {
    return { name: 'upstream', status: 'skip', reason: 'no config to read URL from' };
  }
  const apiKey = process.env.OPENROUTER_API_KEY || cfg.openrouterKey || '';
  if (!apiKey) {
    return { name: 'upstream', status: 'skip', reason: 'no API key to test with' };
  }

  const url = `${cfg.openrouterBaseUrl.replace(/\/$/, '')}/v1/models`;
  const probe = await probeUpstream(
    cfg.openrouterBaseUrl,
    apiKey,
    cfg.authType,
    timeoutMs,
  );
  if (probe.ok) {
    return { name: 'upstream', status: 'ok', url, modelCount: probe.modelCount };
  }
  return { name: 'upstream', status: 'fail', url, message: probe.reason };
}

async function checkPort(host: string, port: number): Promise<Check> {
  return new Promise<Check>(resolveCheck => {
    const tester = createServer();
    let done = false;
    const onSuccess = () => {
      if (done) return;
      done = true;
      // biome-ignore lint/nursery/noFloatingPromises: false positive — resolveCheck is a Promise constructor callback
      resolveCheck({ name: `port-${port}`, status: 'ok', host, port });
      void tester.close();
    };
    const onError = () => {
      if (done) return;
      done = true;
      // biome-ignore lint/nursery/noFloatingPromises: false positive — resolveCheck is a Promise constructor callback
      resolveCheck({
        name: `port-${port}`,
        status: 'fail',
        host,
        port,
        message: `Port ${port} on ${host} is already in use`,
      });
    };
    tester.once('error', onError);
    tester.once('listening', onSuccess);
    tester.listen(port, host);
  });
}

function checkVersion(): Check {
  return {
    name: 'version',
    status: 'ok',
    value: version,
  };
}

const STATUS_GLYPHS: Record<Status, string> = {
  ok: '✓',
  warn: '⚠',
  fail: '✗',
  skip: 'ⓘ',
};

function formatTextCheck(c: Check): string {
  const glyph = STATUS_GLYPHS[c.status];
  const detail = c.message ?? c.value ?? '';
  const tail = c.path ? ` ${c.path}` : '';
  return `${glyph} ${c.name}${tail}${detail ? ` — ${detail}` : ''}`;
}

function printTextSection(title: string, checks: Check[]): void {
  clack.log.step(title);
  for (const c of checks) {
    clack.log.info(formatTextCheck(c));
  }
}

export async function doctorCommand(opts: DoctorOptions = {}): Promise<number> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const offline = opts.offline ?? false;

  // 1. Environment — synchronous, fast
  const envChecks: Check[] = [checkNodeVersion(), checkPlatform(), checkTty()];

  // 2. Config — sync (checkConfigValidity returns the parsed config too)
  const configPath = tryFindConfigFile();
  const { check: validityCheck, config: cfg } = checkConfigValidity(configPath);
  const configChecks: Check[] = [
    checkConfigDiscovery(),
    validityCheck,
    checkSlugCollisions(cfg),
  ];

  // 4. API key
  const apiKeyCheck = checkApiKey(cfg);

  // 5. Network
  const upstreamCheck = await checkUpstream(cfg, timeoutMs, offline);

  // 6. Port
  const portCheck = cfg
    ? await checkPort(cfg.host, cfg.port)
    : ({
        name: 'port',
        status: 'skip',
        reason: 'no config to read host/port from',
      } as Check);

  // 7. Version
  const versionCheck = checkVersion();

  const allChecks: Check[] = [
    ...envChecks,
    ...configChecks,
    apiKeyCheck,
    upstreamCheck,
    portCheck,
    versionCheck,
  ];

  const failed = allChecks.filter(c => c.status === 'fail').length;
  const exitCode = failed === 0 ? 0 : 1;

  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: failed === 0,
          exitCode,
          checks: allChecks,
        },
        null,
        2,
      )}\n`,
    );
    return exitCode;
  }

  clack.intro('Proxitor Doctor');

  printTextSection('Environment', envChecks);
  clack.log.info(`  config: ${configPath ?? 'not found'}`);
  printTextSection('Config', configChecks);
  clack.log.info(`  API key resolution:`);
  clack.log.info(`    ${formatTextCheck(apiKeyCheck)}`);
  printTextSection('Network', [upstreamCheck]);
  clack.log.info(`  port:`);
  clack.log.info(`    ${formatTextCheck(portCheck)}`);
  clack.log.info(`  version:`);
  clack.log.info(`    ${formatTextCheck(versionCheck)}`);

  if (failed === 0) {
    clack.outro('Done. All checks passed.');
  } else {
    clack.outro(`Found ${failed} issue${failed === 1 ? '' : 's'}.`);
  }

  return exitCode;
}
