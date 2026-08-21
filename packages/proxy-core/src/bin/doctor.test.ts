// src/bin/doctor.test.ts
import { type DoctorIo, renderJson, renderText, runDoctor } from './doctor.js';

const CONFIG = `
version: 1
providers:
  openai:
    baseUrl: https://api.openai.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: { env: OPENAI_API_KEY } }
  local:
    baseUrl: https://local.example
    wireFormat: anthropic-messages
    auth: { type: x-api-key, credential: { file: /run/secrets/local-key } }
    headers: { anthropic-version: "2023-06-01" }
models:
  - match: "gpt-*"
    provider: openai
    modelId: "$MODEL"
  - match: "*"
    provider: local
    modelId: "$MODEL"
defaultProvider: openai
server: { host: 127.0.0.1, port: 8828 }
`;

function makeIo(overrides?: Partial<DoctorIo>): DoctorIo {
  return {
    env: { OPENAI_API_KEY: 'sk-test' },
    readFile: async path => {
      if (path === '/cfg/config.yaml') return CONFIG;
      if (path === '/run/secrets/local-key') return 'secret-value\n';
      throw new Error(`unexpected read: ${path}`);
    },
    stat: async () => ({ mode: 0o600 }),
    bindProbe: async () => ({ ok: true }),
    ...overrides,
  };
}

const byName = (report: Awaited<ReturnType<typeof runDoctor>>, name: string) =>
  report.checks.find(check => check.name === name);

describe('runDoctor', () => {
  it('reports all checks ok on a healthy config', async () => {
    const report = await runDoctor({ configPath: '/cfg/config.yaml' }, makeIo());
    expect(byName(report, 'config-found')?.status).toBe('ok');
    expect(byName(report, 'config-valid')?.status).toBe('ok');
    expect(byName(report, 'credential:openai')?.status).toBe('ok');
    expect(byName(report, 'credential:local')?.status).toBe('ok');
    expect(byName(report, 'routing-table')?.status).toBe('ok');
    expect(byName(report, 'activation')?.status).toBe('ok');
    expect(byName(report, 'port-bind')?.status).toBe('ok');
    expect(report.exitCode).toBe(0);
  });

  it('fails config-found on a missing file and skips the dependents', async () => {
    const report = await runDoctor(
      { configPath: '/nope.yaml' },
      makeIo({
        readFile: async () => {
          throw new Error('ENOENT');
        },
      }),
    );
    expect(byName(report, 'config-found')?.status).toBe('fail');
    expect(byName(report, 'config-valid')?.status).toBe('skip');
    expect(byName(report, 'routing-table')?.status).toBe('skip');
    expect(byName(report, 'activation')?.status).toBe('skip');
    expect(report.exitCode).toBe(1);
  });

  it('fails config-valid on a malformed yaml and skips the dependents', async () => {
    const report = await runDoctor(
      { configPath: '/cfg/config.yaml' },
      makeIo({ readFile: async () => 'providers: [' }),
    );
    expect(byName(report, 'config-found')?.status).toBe('ok');
    expect(byName(report, 'config-valid')?.status).toBe('fail');
    expect(byName(report, 'routing-table')?.status).toBe('skip');
    expect(byName(report, 'activation')?.status).toBe('skip');
    expect(report.exitCode).toBe(1);
  });

  it('fails a credential whose env var is unset', async () => {
    const report = await runDoctor(
      { configPath: '/cfg/config.yaml' },
      makeIo({ env: {} }),
    );
    expect(byName(report, 'credential:openai')?.status).toBe('fail');
    expect(byName(report, 'credential:openai')?.detail).toContain('OPENAI_API_KEY');
    expect(report.exitCode).toBe(1);
  });

  it('fails a file credential with permissions looser than 0600', async () => {
    const report = await runDoctor(
      { configPath: '/cfg/config.yaml' },
      makeIo({ stat: async () => ({ mode: 0o644 }) }),
    );
    expect(byName(report, 'credential:local')?.status).toBe('fail');
    expect(byName(report, 'credential:local')?.detail).toContain('0600');
    expect(report.exitCode).toBe(1);
  });

  it('fails routing when a provider baseUrl already ends in an endpoint path', async () => {
    const bad = CONFIG.replace(
      'baseUrl: https://api.openai.com\n',
      'baseUrl: https://api.openai.com/v1/chat/completions\n',
    );
    const report = await runDoctor(
      { configPath: '/cfg/config.yaml' },
      makeIo({ readFile: async () => bad }),
    );
    expect(byName(report, 'config-valid')?.status).toBe('ok');
    expect(byName(report, 'routing-table')?.status).toBe('fail');
    expect(report.exitCode).toBe(1);
  });

  it('fails activation for an unknown plugin', async () => {
    const bad = `${CONFIG}plugins:\n  - no-such-plugin\n`;
    const report = await runDoctor(
      { configPath: '/cfg/config.yaml' },
      makeIo({ readFile: async () => bad }),
    );
    expect(byName(report, 'activation')?.status).toBe('fail');
    expect(report.exitCode).toBe(1);
  });

  it('warns but exits 0 when the port is taken', async () => {
    const report = await runDoctor(
      { configPath: '/cfg/config.yaml' },
      makeIo({ bindProbe: async () => ({ ok: false, detail: 'EADDRINUSE' }) }),
    );
    expect(byName(report, 'port-bind')?.status).toBe('warn');
    expect(report.exitCode).toBe(0);
  });

  it('renders the routing table as the routing-table detail', async () => {
    const report = await runDoctor({ configPath: '/cfg/config.yaml' }, makeIo());
    expect(byName(report, 'routing-table')?.detail).toContain('gpt-* → openai / $MODEL');
  });
});

describe('renderers', () => {
  it('renderText marks each status and renderJson round-trips', async () => {
    const report = await runDoctor({ configPath: '/cfg/config.yaml' }, makeIo());
    const text = renderText(report);
    expect(text).toContain('✓ config-found');
    expect(text).toContain('✓ routing-table');
    const parsed = JSON.parse(renderJson(report)) as {
      checks: unknown[];
      exitCode: number;
    };
    expect(parsed.checks).toHaveLength(report.checks.length);
    expect(parsed.exitCode).toBe(0);
  });
});
