import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// Resolve absolute path to dist/cli.mjs from the test file location
// Test file is at: packages/proxy-core/src/bin/cli-smoke.test.ts
// CLI is at: packages/proxy-core/dist/cli.mjs
// So we need: up two levels (from src/bin to proxy-core), then into dist/cli.mjs
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'cli.mjs');

describe.skipIf(!existsSync(CLI))('built cli smoke', () => {
  it('root help lists all three commands', async () => {
    const { stdout } = await exec('node', [CLI, '--help']);
    expect(stdout).toContain('start');
    expect(stdout).toContain('config');
    expect(stdout).toContain('doctor');
  });

  it('doctor passes on a healthy config via XDG discovery', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'proxitor-smoke-'));
    const nested = join(dir, 'proxitor'); // createConfigFile searches $XDG/proxitor/
    await mkdir(nested, { recursive: true });
    await writeFile(
      join(nested, 'config.yaml'),
      [
        'version: 1',
        'providers:',
        '  openai:',
        '    baseUrl: https://api.openai.com',
        '    wireFormat: openai-chat',
        '    auth: { type: bearer, credential: { env: SMOKE_KEY } }',
        'models:',
        '  - match: "*"',
        '    provider: openai',
        '    modelId: "$MODEL"',
        'defaultProvider: openai',
        'server: { host: 127.0.0.1, port: 8828 }',
        '',
      ].join('\n'),
      'utf8',
    );
    const { stdout } = await exec('node', [CLI, 'doctor'], {
      env: { ...process.env, SMOKE_KEY: 'sk-smoke', XDG_CONFIG_HOME: dir },
    });
    expect(stdout).toContain('✓ config-found');
    expect(stdout).not.toContain('✗');
  });
});
