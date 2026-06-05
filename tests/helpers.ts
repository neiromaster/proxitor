import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { type AddressInfo, createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createProxyServer, type ProxyConfig } from '../src/index.js';

/** Get a random available port */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.listen(0, () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

export type TestEnv = {
  proxyUrl: string;
  cleanup: () => Promise<void>;
};

/**
 * Start a mock upstream + proxitor proxy on random ports.
 * Override `openrouterBaseUrl` in configOverrides to point to a dead upstream (for error tests).
 */
export async function createTestEnv(
  configOverrides?: Partial<ProxyConfig>,
  setupUpstream?: (app: Hono) => void,
): Promise<TestEnv> {
  const upstreamPort = await getFreePort();
  const proxyPort = await getFreePort();

  // --- mock upstream ---
  const upstreamApp = new Hono();
  setupUpstream?.(upstreamApp);
  // default catch-all fallback
  upstreamApp.all('*', async c => {
    return c.json({ path: c.req.path, method: c.req.method });
  });

  const upstreamServer = await new Promise<Server>(resolve => {
    const server = serve(
      { fetch: upstreamApp.fetch, port: upstreamPort, hostname: '127.0.0.1' },
      () => resolve(server),
    );
  });

  // --- proxy ---
  const config: ProxyConfig = {
    host: '127.0.0.1',
    port: proxyPort,
    openrouterKey: 'test-api-key',
    openrouterBaseUrl: `http://127.0.0.1:${upstreamPort}`,
    verbose: false,
    bodyLimit: '50mb',
    attributionReferer: 'https://github.com/neiromaster/proxitor',
    attributionTitle: 'proxitor-test',
    ...configOverrides,
  };

  const proxyServer = await new Promise<Server>(resolve => {
    const server = createProxyServer(config, () => resolve(server));
  });

  return {
    proxyUrl: `http://127.0.0.1:${proxyPort}`,
    cleanup: async () => {
      await new Promise<void>(r => proxyServer.close(() => r()));
      await new Promise<void>(r => upstreamServer.close(() => r()));
    },
  };
}

export function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'proxitor-test-'));
}

export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
