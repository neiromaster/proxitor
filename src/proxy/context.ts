import type { HttpBindings } from '@hono/node-server';
import type { ProxyConfig, ResolvedModelConfig } from '../config.js';

export type ProxyVariables = {
  config: ProxyConfig;
  reqId: string;
  method: string;
  path: string;
  upstreamUrl: string;
  startedAt: number;
  rawBody: ArrayBuffer | undefined;
  parsedBody: Record<string, unknown> | undefined;
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
