import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { binary, runSafely } from 'cmd-ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rootCli } from '../../src/cli-commands.js';
import { createTestEnv, type TestEnv } from '../helpers.js';

/** Read a useful message out of cmd-ts `Err(Exit)`. */
function errorMessage(err: { config?: { message?: string }; message?: string }): string {
  return err.config?.message ?? err.message ?? '';
}

// Replicate cli.ts's argv-prefix trick: prepend `start` when user gave only
// flags (or nothing), so `proxitor --help` shows start's help.
async function runCli(userArgs: string[]) {
  const finalArgv =
    userArgs.length === 0 || userArgs[0]?.startsWith('-')
      ? ['node', 'proxitor', 'start', ...userArgs]
      : ['node', 'proxitor', ...userArgs];
  return runSafely(binary(rootCli), finalArgv);
}

describe('CLI dispatch and help', () => {
  it('--version on the root command prints the version', async () => {
    const result = await runCli(['--version']);
    // --version triggers an Exit, which runSafely captures as Err.
    if (result._tag === 'error') {
      expect(errorMessage(result.error)).toMatch(/\d+\.\d+\.\d+/);
    } else {
      throw new Error('expected --version to produce an error');
    }
  });

  it('--help on the root command shows start help (default command)', async () => {
    const result = await runCli(['--help']);
    if (result._tag === 'error') {
      expect(errorMessage(result.error)).toContain('Start the proxy server');
    } else {
      throw new Error('expected --help to produce an error');
    }
  });

  it('an unknown flag at the root produces a parse error', async () => {
    const result = await runCli(['--definitely-not-a-flag']);
    expect(result._tag).toBe('error');
  });

  it('an unknown subcommand produces a parse error', async () => {
    const result = await runSafely(binary(rootCli), ['node', 'proxitor', 'banana']);
    expect(result._tag).toBe('error');
  });
});

describe('start command validation', () => {
  it('rejects an out-of-range port at parse time', async () => {
    const result = await runCli(['--port', '99999']);
    expect(result._tag).toBe('error');
    if (result._tag === 'error') {
      expect(errorMessage(result.error)).toContain('1-65535');
    }
  });

  it('rejects a non-integer port at parse time', async () => {
    const result = await runCli(['--port', '3.5']);
    expect(result._tag).toBe('error');
    if (result._tag === 'error') {
      expect(errorMessage(result.error)).toContain('1-65535');
    }
  });

  it('rejects a negative port at parse time', async () => {
    const result = await runCli(['--port', '-1']);
    expect(result._tag).toBe('error');
    if (result._tag === 'error') {
      expect(errorMessage(result.error)).toContain('1-65535');
    }
  });

  it('accepts a valid port (parsing succeeds)', async () => {
    // Parsing succeeds; the handler then calls loadConfig and startProxyServer.
    // In a test environment without a real port to bind, the proxy may fail
    // later, but that's not what this test exercises.
    // We just verify the error (if any) is NOT a port validation error.
    const result = await runCli([
      '--no-config',
      '--openrouter-key',
      'sk-test',
      '--port',
      '18828',
    ]);
    if (result._tag === 'error') {
      expect(errorMessage(result.error)).not.toContain('1-65535');
    }
  });
});

describe('config command (no config file)', () => {
  // These tests run from a tmpdir to ensure no proxitor.config.yaml is present.
  const cwd = process.cwd();
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'proxitor-cli-test-'));
    process.chdir(tmp);
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('config list throws MissingConfigError when no config exists', async () => {
    const { listOverridesCommand } = await import('../../src/commands/config/list.js');
    await expect(listOverridesCommand({})).rejects.toThrow(
      /No proxitor config file found/,
    );
  });

  it('config validate warns and exits cleanly when no config exists', async () => {
    const { validateConfigCommand } = await import(
      '../../src/commands/config/validate.js'
    );
    await expect(validateConfigCommand()).resolves.toBeUndefined();
  });

  it('config show warns and exits cleanly when no config and no key', async () => {
    // showConfigCommand degrades gracefully: it warns and exits
    // without throwing (no file to read means nothing meaningful to show).
    const { showConfigCommand } = await import('../../src/commands/config/show.js');
    await expect(showConfigCommand({})).resolves.toBeUndefined();
  });
});

describe('config command (with a config file)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'proxitor-cli-test-'));
    writeFileSync(
      join(tmp, 'proxitor.config.yaml'),
      ['openrouterKey: "sk-test-cli"', 'port: 9999', 'host: "127.0.0.1"'].join('\n'),
    );
    process.chdir(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('config list --json emits JSON', async () => {
    const { listOverridesCommand } = await import('../../src/commands/config/list.js');
    const stdout: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => {
      stdout.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    };
    try {
      await listOverridesCommand({ json: true });
    } finally {
      process.stdout.write = origWrite;
    }
    const out = stdout.join('');
    // Empty overrides list emits `[]\n`.
    expect(out.trim()).toBe('[]');
  });
});

describe('start command end-to-end', () => {
  let env: TestEnv;

  afterEach(async () => {
    if (env) await env.cleanup();
  });

  it('start brings up the proxy against a mock upstream and answers /health', async () => {
    // This exercises the same code path as the parsed `start` command:
    // createProxyServer with a real config, then a request to /health.
    // (The same flow is tested more thoroughly in health.test.ts.)
    env = await createTestEnv();
    const res = await fetch(`${env.proxyUrl}/health`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean };
    expect(data.ok).toBe(true);
  });
});
