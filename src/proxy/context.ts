import type { HttpBindings } from '@hono/node-server';
import type { ProxyConfig, ResolvedModelConfig } from '../config.js';

export interface ParsedRequestBody extends Record<string, unknown> {
  cache_control?: Record<string, unknown>;
  input?: unknown;
  instructions?: unknown;
  messages?: Array<{ role?: string; content?: unknown } & Record<string, unknown>>;
  model?: string;
  provider?: Record<string, unknown>;
  session_id?: string;
  system?: unknown;
}

export type ProxyVariables = {
  config: ProxyConfig;
  reqId: string;
  method: string;
  path: string;
  upstreamUrl: string;
  startedAt: number;
  rawBody: ArrayBuffer | undefined;
  parsedBody: ParsedRequestBody | undefined;
  modelName: string | undefined;
  resolvedConfig: ResolvedModelConfig;
  bodyMutated: boolean;
  effectiveSessionId: string | undefined;
  forwardBody: ArrayBuffer | undefined;
  upstreamHeaders: Record<string, string>;
};

export type ProxyEnv = {
  Variables: ProxyVariables;
  Bindings: HttpBindings;
};
