import type { LoggerPort } from '@proxitor/plugin-api';
import type { Hono } from 'hono';
import type { ProxyConfig } from '../../application/config-schema.js';
import { createProxitor } from '../../composition-root.js';

export type CapturedUpstream = {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
};

export type TestEnv = {
  readonly app: Hono;
  readonly calls: CapturedUpstream[];
  readonly config: ProxyConfig;
};

const SILENT: LoggerPort = { info() {}, warn() {}, error() {}, debug() {} };

/** createTestEnv harness (spec §12): full stack through the real hono app + config parse. */
export async function createTestEnv(options: {
  configText: string;
  env?: Record<string, string | undefined>;
  upstream: (call: CapturedUpstream, index: number) => Promise<Response> | Response;
}): Promise<TestEnv> {
  const calls: CapturedUpstream[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const request = new Request(url, init);
    const headers: Record<string, string> = {};
    for (const [name, value] of request.headers.entries())
      headers[name.toLowerCase()] = value;
    const call: CapturedUpstream = {
      url,
      method: request.method,
      headers,
      body: await request.text(),
    };
    calls.push(call);
    return options.upstream(call, calls.length - 1);
  };
  const proxitor = await createProxitor({
    configText: options.configText,
    env: options.env ?? {},
    fetchImpl,
    logger: SILENT,
  });
  return { app: proxitor.app, calls, config: proxitor.config };
}
