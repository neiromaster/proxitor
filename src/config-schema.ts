import { z } from 'zod';

export const OPENROUTER_API_URL = 'https://openrouter.ai/api';

const stringOrArraySchema = z.union([z.string(), z.array(z.string())]);

const percentileCutoffsSchema = z
  .object({
    p50: z.number().positive().optional(),
    p75: z.number().positive().optional(),
    p90: z.number().positive().optional(),
    p99: z.number().positive().optional(),
  })
  .strict();

const providerSortSchema = z.union([
  z.enum(['price', 'throughput', 'latency']),
  z
    .object({
      by: z.enum(['price', 'throughput', 'latency']),
      partition: z.enum(['model', 'none']).optional(),
    })
    .strict(),
]);

const maxPriceSchema = z
  .object({
    prompt: z.number().nonnegative().optional(),
    completion: z.number().nonnegative().optional(),
    request: z.number().nonnegative().optional(),
    image: z.number().nonnegative().optional(),
  })
  .strict();

const providerConfigSchema = z
  .object({
    only: stringOrArraySchema.optional(),
    order: stringOrArraySchema.optional(),
    ignore: stringOrArraySchema.optional(),
    allowFallbacks: z.boolean().optional(),
    sort: providerSortSchema.optional(),
    quantizations: z.array(z.string()).optional(),
    maxPrice: maxPriceSchema.optional(),
    requireParameters: z.boolean().optional(),
    dataCollection: z.enum(['allow', 'deny']).optional(),
    zdr: z.boolean().optional(),
    enforceDistillableText: z.boolean().optional(),
    preferredMinThroughput: z
      .union([z.number().positive(), percentileCutoffsSchema])
      .optional(),
    preferredMaxLatency: z
      .union([z.number().positive(), percentileCutoffsSchema])
      .optional(),
  })
  .strict();

const triStateSchema = z.enum(['auto', 'always', 'skip']);
const ttlSchema = z.enum(['5m', '1h', 'omit', 'skip']);

const modelOverrideSchema = z
  .object({
    provider: providerConfigSchema.optional(),
    headers: z.record(z.string(), z.string()).optional(),
    cacheControl: triStateSchema.optional(),
    cacheControlTtl: ttlSchema.optional(),
    rewriteBlockTtl: triStateSchema.optional(),
    sessionId: triStateSchema.optional(),
    normalizeVolatileSystem: z.boolean().optional(),
  })
  .strict();

export const proxyConfigSchema = z
  .object({
    host: z.string().min(1).default('0.0.0.0'),
    port: z.number().int().min(1).max(65535).default(8828),
    openrouterKey: z.string().default(''),
    openrouterBaseUrl: z.string().url().default(OPENROUTER_API_URL),
    openrouterDataUrl: z.string().url().optional(),
    authType: z.enum(['bearer', 'oauth']).default('bearer'),
    verbose: z.boolean().default(false),
    bodyLimit: z.string().min(1).default('50mb'),
    provider: providerConfigSchema.optional(),
    attributionReferer: z
      .string()
      .min(1)
      .default('https://github.com/neiromaster/proxitor'),
    attributionTitle: z.string().min(1).default('proxitor'),
    headers: z.record(z.string(), z.string()).optional(),
    cacheControl: triStateSchema.default('auto'),
    cacheControlTtl: ttlSchema.optional(),
    rewriteBlockTtl: triStateSchema.default('skip'),
    sessionId: triStateSchema.default('auto'),
    normalizeVolatileSystem: z.boolean().default(false),
    modelOverrides: z.record(z.string().min(1), modelOverrideSchema).optional(),
  })
  .strict();

export const DEFAULTS: ProxyConfig = proxyConfigSchema.parse({});

export const proxyConfigFileSchema = proxyConfigSchema.partial();

export type ProxyConfig = z.infer<typeof proxyConfigSchema>;
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type ModelOverride = z.infer<typeof modelOverrideSchema>;
export type AuthType = z.infer<typeof proxyConfigSchema>['authType'];
export type TriState = 'auto' | 'always' | 'skip';

export class ConfigParseError extends Error {
  constructor(filePath: string, cause?: Error) {
    super(
      `Failed to parse config file ${filePath}: ${cause?.message ?? 'unknown error'}`,
      { cause },
    );
    this.name = 'ConfigParseError';
  }
}

export class ConfigValidationError extends Error {
  readonly zodError: z.ZodError;

  constructor(filePath: string, zodError: z.ZodError) {
    const lines = zodError.issues.map(issue => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `  ${path}: ${issue.message}`;
    });
    super(`Invalid config in ${filePath}:\n${lines.join('\n')}`);
    this.name = 'ConfigValidationError';
    this.zodError = zodError;
  }
}

/** No config found via discovery — catch with `instanceof` to offer creating one. */
export class MissingConfigError extends Error {
  readonly searchedPaths: readonly string[];

  constructor(searchedPaths: readonly string[]) {
    super(
      `No proxitor config file found.\n` +
        `Searched:\n${searchedPaths.map(p => `  - ${p}`).join('\n')}\n\n` +
        `Run \`proxitor config wizard\` to create one, or pass a config path explicitly.`,
    );
    this.name = 'MissingConfigError';
    this.searchedPaths = searchedPaths;
  }
}
