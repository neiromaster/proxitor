import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ServerType, serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ConfigSource,
  createConfigSource,
  createProxyServer,
  loadConfig,
  type ProxyConfig,
} from '../../src/index.js';

function touchFuture(path: string, addSeconds: number): void {
  const when = Date.now() / 1000 + addSeconds;
  utimesSync(path, when, when);
}

describe('config hot-reload (integration)', () => {
  let upstream: ServerType | undefined;
  let proxy: ServerType | undefined;
  let source: ConfigSource | undefined;

  afterEach(async () => {
    source?.stop();
    if (proxy) await new Promise<void>(r => proxy!.close(() => r()));
    if (upstream) await new Promise<void>(r => upstream!.close(() => r()));
  });

  it('applies a config edit to subsequent requests without restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proxitor-hotreload-'));

    // upstream records the forwarded body
    let lastBody: unknown;
    const upstreamApp = new Hono();
    upstreamApp.post('/v1/messages', async c => {
      lastBody = await c.req.json();
      return c.json({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        model: 'claude-sonnet-4-6',
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 1 },
      });
    });
    upstream = await new Promise<ServerType>(resolve => {
      const server = serve(
        { fetch: upstreamApp.fetch, port: 0, hostname: '127.0.0.1' },
        () => resolve(server),
      );
    });
    const upstreamPort = (upstream.address() as AddressInfo).port;

    // cacheControl: skip → no injection
    const configPath = join(dir, 'config.yaml');
    const writeConfig = (cacheControl: string): void => {
      writeFileSync(
        configPath,
        [
          'openrouterKey: test-key',
          `openrouterBaseUrl: http://127.0.0.1:${upstreamPort}`,
          `cacheControl: ${cacheControl}`,
        ].join('\n'),
      );
    };
    writeConfig('skip');

    const fileConfig = await loadConfig({ configPath });
    // port:0 binds a free port; reloads come from the file.
    const initial: ProxyConfig = { ...fileConfig, host: '127.0.0.1', port: 0 };
    source = createConfigSource({
      loadOptions: { configPath },
      initial,
      pollIntervalMs: 50,
    });
    source.start();

    proxy = await new Promise<ServerType>(resolve => {
      const server = createProxyServer(source!, () => resolve(server));
    });
    const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;

    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 16,
      system: [{ type: 'text', text: 'sys' }],
      messages: [{ role: 'user', content: 'hi' }],
    });

    // request 1: skip → no cache_control
    lastBody = undefined;
    await fetch(`${proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(JSON.stringify(lastBody)).not.toContain('cache_control');

    // flip cacheControl → always
    writeConfig('always');
    touchFuture(configPath, 2);
    await vi.waitFor(() => expect(source!.get().cacheControl).toBe('always'), {
      timeout: 2000,
      interval: 30,
    });

    // request 2: cache_control present
    lastBody = undefined;
    await fetch(`${proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(JSON.stringify(lastBody)).toContain('cache_control');
  }, 15000);
});
