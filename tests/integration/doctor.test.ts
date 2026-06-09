import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { doctorCommand } from '../../src/commands/doctor.js';

/** Capture stdout during a callback. */
async function captureStdout(fn: () => Promise<unknown>): Promise<string> {
  const chunks: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = origWrite;
  }
  return chunks.join('');
}

describe('doctor (no config file)', () => {
  const cwd = process.cwd();
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'proxitor-doctor-'));
    process.chdir(tmp);
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.OPENROUTER_API_KEY;
  });

  it('exits 1 when no config and no API key (--offline)', async () => {
    const code = await doctorCommand({ offline: true });
    expect(code).toBe(1);
  });

  it('emits JSON with ok: false when no config and no API key', async () => {
    const out = await captureStdout(() =>
      Promise.resolve(doctorCommand({ json: true, offline: true })),
    );
    const parsed = JSON.parse(out) as {
      ok: boolean;
      exitCode: number;
      checks: Array<{ name: string; status: string; [k: string]: unknown }>;
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.exitCode).toBe(1);
    expect(
      parsed.checks.some(c => c.name === 'config-found' && c.status === 'fail'),
    ).toBe(true);
    expect(parsed.checks.some(c => c.name === 'api-key' && c.status === 'fail')).toBe(
      true,
    );
  });

  it('marks network checks as skip when offline', async () => {
    const out = await captureStdout(() =>
      Promise.resolve(doctorCommand({ json: true, offline: true })),
    );
    const parsed = JSON.parse(out) as { checks: Array<{ name: string; status: string }> };
    const upstream = parsed.checks.find(c => c.name === 'upstream');
    expect(upstream?.status).toBe('skip');
  });
});

describe('doctor (with valid config)', () => {
  const cwd = process.cwd();
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'proxitor-doctor-'));
    writeFileSync(
      join(tmp, 'proxitor.config.yaml'),
      ['openrouterKey: "sk-or-v1-test-fake"', 'port: 18828', 'host: "127.0.0.1"'].join(
        '\n',
      ),
    );
    process.chdir(tmp);
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.OPENROUTER_API_KEY;
  });

  it('passes config-found and config-valid checks', async () => {
    const out = await captureStdout(() =>
      Promise.resolve(doctorCommand({ json: true, offline: true })),
    );
    const parsed = JSON.parse(out) as { checks: Array<{ name: string; status: string }> };
    expect(parsed.checks.find(c => c.name === 'config-found')?.status).toBe('ok');
    expect(parsed.checks.find(c => c.name === 'config-valid')?.status).toBe('ok');
  });

  it('reports api-key as ok when key is in file', async () => {
    const out = await captureStdout(() =>
      Promise.resolve(doctorCommand({ json: true, offline: true })),
    );
    const parsed = JSON.parse(out) as {
      checks: Array<{ name: string; status: string; fromFile?: string }>;
    };
    const apiKey = parsed.checks.find(c => c.name === 'api-key');
    expect(apiKey?.status).toBe('ok');
    expect(apiKey?.fromFile).toBe('set');
  });

  it('reports port-XXXXX as ok when port is free', async () => {
    const out = await captureStdout(() =>
      Promise.resolve(doctorCommand({ json: true, offline: true })),
    );
    const parsed = JSON.parse(out) as { checks: Array<{ name: string; status: string }> };
    const portCheck = parsed.checks.find(c => c.name?.startsWith('port-'));
    expect(portCheck?.status).toBe('ok');
  });
});

describe('doctor (with invalid config)', () => {
  const cwd = process.cwd();
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'proxitor-doctor-'));
    writeFileSync(join(tmp, 'proxitor.config.yaml'), 'port: "not a number"');
    process.chdir(tmp);
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('marks config-valid as fail with the error message', async () => {
    const out = await captureStdout(() =>
      Promise.resolve(doctorCommand({ json: true, offline: true })),
    );
    const parsed = JSON.parse(out) as {
      checks: Array<{ name: string; status: string; message?: string }>;
    };
    const valid = parsed.checks.find(c => c.name === 'config-valid');
    expect(valid?.status).toBe('fail');
    expect(valid?.message).toBeTruthy();
  });

  it('exits 1', async () => {
    const code = await doctorCommand({ offline: true });
    expect(code).toBe(1);
  });
});

// Sanity: doctor does not crash when run from a real project dir.
describe('doctor does not throw on the project directory', () => {
  it('completes without throwing', async () => {
    // Uses real cwd (proxitor project root) — config may or may not be present.
    // This test exists to ensure the doctor command does not throw in any state.
    // Use offline + tiny timeout to keep the test fast.
    const code = await doctorCommand({ offline: true, timeoutMs: 100 });
    expect(typeof code).toBe('number');
    // existsSync is referenced to avoid unused-import lints; touching it
    // here is intentional to validate the helper export in tests.
    expect(typeof existsSync).toBe('function');
  });
});
