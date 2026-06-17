import { mkdtempSync, rmSync } from 'node:fs';
import { type AddressInfo, createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ServerType, serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createProxyServer, type ProxyConfig, staticConfigSource } from '../src/index.js';

/** Get a random available port (used by cli.test.ts for CLI flag tests). */
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
 *
 * Uses `port: 0` so the OS assigns a free port atomically — eliminates the
 * race condition where `getFreePort()` could return a port that another
 * parallel test grabs before `serve()` binds it.
 */
export async function createTestEnv(
  configOverrides?: Partial<ProxyConfig>,
  setupUpstream?: (app: Hono) => void,
): Promise<TestEnv> {
  // --- mock upstream (port 0 → OS picks a free port) ---
  const upstreamApp = new Hono();
  setupUpstream?.(upstreamApp);
  // default catch-all fallback
  upstreamApp.all('*', async c => {
    return c.json({ path: c.req.path, method: c.req.method });
  });

  const { server: upstreamServer, port: upstreamPort } = await new Promise<{
    server: ServerType;
    port: number;
  }>(resolve => {
    const server = serve(
      { fetch: upstreamApp.fetch, port: 0, hostname: '127.0.0.1' },
      info => {
        const port = (info as AddressInfo).port;
        resolve({ server, port });
      },
    );
  });

  // --- proxy (port 0 → OS picks a free port) ---
  const config: ProxyConfig = {
    host: '127.0.0.1',
    port: 0,
    openrouterKey: 'test-api-key',
    openrouterBaseUrl: `http://127.0.0.1:${upstreamPort}`,
    authType: 'bearer',
    cacheControl: 'auto',
    sessionId: 'auto',
    normalizeVolatileSystem: false,
    verbose: false,
    bodyLimit: '50mb',
    attributionReferer: 'https://github.com/neiromaster/proxitor',
    attributionTitle: 'proxitor-test',
    ...configOverrides,
  };

  const { server: proxyServer, port: proxyPort } = await new Promise<{
    server: ServerType;
    port: number;
  }>(resolve => {
    const server = createProxyServer(staticConfigSource(config), () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, port: addr.port });
    });
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
