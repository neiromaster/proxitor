import type { HttpBindings } from '@hono/node-server';
import type { ResolvedModelConfig } from '../config.js';

export type ProxyVariables = {
  // Phase 1: Request setup
  reqId: string;
  method: string;
  path: string;
  upstreamUrl: string;
  startedAt: number;

  // Phase 2: Body
  rawBody: ArrayBuffer | undefined;

  // Phase 3: Parsed body
  parsedBody: Record<string, unknown> | undefined;
  modelName: string | undefined;

  // Phase 4: Config resolution
  resolvedConfig: ResolvedModelConfig;

  // Phase 5: Injection results
  bodyMutated: boolean;
  effectiveSessionId: string | undefined;

  // Phase 6: Final request
  forwardBody: ArrayBuffer | undefined;
  upstreamHeaders: Record<string, string>;
};

export type ProxyEnv = {
  Variables: ProxyVariables;
  Bindings: HttpBindings;
};
