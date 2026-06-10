import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readConfigFile } from '../../src/config.js';

// Mock @clack/prompts — control all interactive inputs
const cancelSymbol = Symbol.for('clack:cancel');

function createMockController() {
  const answers: unknown[] = [];
  let idx = 0;

  const next = () => {
    if (idx >= answers.length)
      throw new Error(`No more mock answers (called ${idx + 1})`);
    return answers[idx++];
  };

  const enqueue = (...vals: unknown[]) => {
    answers.push(...vals);
  };

  const text = vi.fn(async () => next());
  const select = vi.fn(async () => next());
  const confirm = vi.fn(async () => next());

  return {
    enqueue,
    fns: { text, select, confirm },
    reset: () => {
      answers.length = 0;
      idx = 0;
    },
  };
}

type MockController = ReturnType<typeof createMockController>;
const mockRef: { ctrl: MockController } = { ctrl: null as unknown as MockController };

vi.mock('@clack/prompts', () => {
  const ctrl = createMockController();
  mockRef.ctrl = ctrl;

  const noop = vi.fn();
  const logMock = { step: noop, success: noop, warn: noop, info: noop };

  return {
    default: {
      intro: noop,
      outro: noop,
      note: noop,
      text: ctrl.fns.text,
      select: ctrl.fns.select,
      confirm: ctrl.fns.confirm,
      isCancel: (v: unknown) => v === cancelSymbol,
      log: logMock,
    },
    intro: noop,
    outro: noop,
    note: noop,
    text: ctrl.fns.text,
    select: ctrl.fns.select,
    confirm: ctrl.fns.confirm,
    isCancel: (v: unknown) => v === cancelSymbol,
    log: logMock,
  };
});

// Mock probeUpstream to avoid real network calls
vi.mock('../../src/openrouter/data-client.js', () => ({
  probeUpstream: vi.fn(async () => ({ ok: true, modelCount: 42 })),
}));

// Import wizard AFTER mocks are set up
const { runWizard } = await import('../../src/commands/config/wizard.js');

let tmpDir: string;
const originalCwd = process.cwd();

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'proxitor-wizard-'));
  process.chdir(tmpDir);
  mockRef.ctrl.reset();
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('runWizard', () => {
  it('completes full flow and writes config file', async () => {
    const { enqueue } = mockRef.ctrl;

    // No existing config — skip reconfigure prompt
    // Step 1: API key (clack.text)
    enqueue('sk-or-v1-testkey1234567890abcdef');
    // Step 2: Port (clack.text)
    enqueue('8828');
    // Step 3: Host (clack.select → 0.0.0.0)
    enqueue('0.0.0.0');
    // Step 4: Base URL (clack.text → empty = default)
    enqueue('');
    // Step 5: Auth type (clack.select → bearer)
    enqueue('bearer');
    // Step 6: Save location (clack.select → local)
    enqueue('local');
    // Save confirm (clack.confirm → true)
    enqueue(true);

    await runWizard();

    const configPath = resolve(tmpDir, 'proxitor.config.yaml');
    expect(existsSync(configPath)).toBe(true);

    const config = readConfigFile(configPath);
    expect(config.openrouterKey).toBe('sk-or-v1-testkey1234567890abcdef');
    expect(config.port).toBe(8828);
    expect(config.host).toBe('0.0.0.0');
  });

  it('accepts custom host value', async () => {
    const { enqueue } = mockRef.ctrl;

    // Step 1: API key
    enqueue('sk-or-v1-testkey1234567890abcdef');
    // Step 2: Port
    enqueue('8828');
    // Step 3: Host select → custom
    enqueue('__custom__');
    // Custom host text input
    enqueue('192.168.1.100');
    // Step 4: Base URL
    enqueue('');
    // Step 5: Auth type
    enqueue('bearer');
    // Step 6: Save location
    enqueue('local');
    // Save confirm
    enqueue(true);

    await runWizard();

    const configPath = resolve(tmpDir, 'proxitor.config.yaml');
    const config = readConfigFile(configPath);
    expect(config.host).toBe('192.168.1.100');
  });

  it('does not write file when cancelled', async () => {
    const { enqueue } = mockRef.ctrl;

    // Step 1: API key
    enqueue('sk-or-v1-testkey1234567890abcdef');
    // Step 2: Port
    enqueue('8828');
    // Step 3: Host
    enqueue('0.0.0.0');
    // Step 4: Base URL — cancel
    enqueue(cancelSymbol);

    await runWizard();

    const configPath = resolve(tmpDir, 'proxitor.config.yaml');
    expect(existsSync(configPath)).toBe(false);
  });

  it('reconfigures existing config with pre-filled values', async () => {
    const configPath = resolve(tmpDir, 'proxitor.config.yaml');

    // Write an existing config
    const existingYaml = [
      'openrouterKey: old-key-value',
      'port: 9999',
      'host: 127.0.0.1',
      'openrouterBaseUrl: https://custom.api/v1',
      'authType: oauth',
    ].join('\n');
    writeFileSync(configPath, existingYaml, 'utf-8');

    const { enqueue } = mockRef.ctrl;

    // Reconfigure confirm → yes
    enqueue(true);
    // Step 1: API key — keep old key
    enqueue('old-key-value');
    // Step 2: Port — change to 3000
    enqueue('3000');
    // Step 3: Host
    enqueue('127.0.0.1');
    // Step 4: Base URL — keep custom
    enqueue('https://custom.api/v1');
    // Step 5: Auth type — keep oauth
    enqueue('oauth');
    // Step 6: Save location → local (detected)
    enqueue('local');
    // Save confirm
    enqueue(true);

    await runWizard({ configPath });

    const config = readConfigFile(configPath);
    expect(config.openrouterKey).toBe('old-key-value');
    expect(config.port).toBe(3000);
    expect(config.authType).toBe('oauth');
  });
});
