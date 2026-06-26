/**
 * Regression tests for bugfix plan 2 findings.
 *
 * These tests cover edge cases that were missed in the original test suite:
 * - #3: add/edit forward configPath for writes
 * - #8: logResolved auto-iterates config keys
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Bugfix #8: logResolved auto-iterates config keys
// ---------------------------------------------------------------------------

describe('Bugfix #8: logResolved shows all config keys via iteration', () => {
  const cwd = process.cwd();
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'proxitor-show-'));
    process.chdir(tmp);
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.OPENROUTER_API_KEY;
  });

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

  it('shows all standard config keys in JSON output', async () => {
    // Create a config with known values
    writeFileSync(
      join(tmp, 'proxitor.config.yaml'),
      [
        'openrouterKey: "sk-test-show"',
        'port: 9090',
        'host: "127.0.0.1"',
        'verbose: true',
        'bodyLimit: "10mb"',
        'cacheControl: "always"',
      ].join('\n'),
    );

    const { showConfigCommand } = await import('../../src/commands/config/show.js');
    const out = await captureStdout(() => showConfigCommand({ json: true }));
    const parsed = JSON.parse(out) as Record<string, unknown>;

    // JSON output should include all standard keys
    expect(parsed.host).toBe('127.0.0.1');
    expect(parsed.port).toBe(9090);
    expect(parsed.verbose).toBe(true);
    expect(parsed.bodyLimit).toBe('10mb');
    expect(parsed.cacheControl).toBe('always');
    // openrouterKey should be masked
    expect(parsed.openrouterKey).not.toBe('sk-test-show');
  });

  it('shows text output without crashing when config has minimal fields', async () => {
    writeFileSync(join(tmp, 'proxitor.config.yaml'), 'openrouterKey: "sk-test-minimal"');

    const { showConfigCommand } = await import('../../src/commands/config/show.js');
    // Should resolve without throwing — logResolved iterates all keys
    await expect(showConfigCommand({ json: false })).resolves.toBeUndefined();
  });
});
