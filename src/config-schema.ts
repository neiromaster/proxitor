import { z } from 'zod';

export const OPENROUTER_API_URL = 'https://openrouter.ai/api';

export const percentileCutoffsSchema = z
  .object({
    p50: z.number().positive().optional(),
    p75: z.number().positive().optional(),
    p90: z.number().positive().optional(),
    p99: z.number().positive().optional(),
  })
  .strict();

export const providerSortSchema = z.union([
  z.enum(['price', 'throughput', 'latency']),
  z
    .object({
      by: z.enum(['price', 'throughput', 'latency']),
      partition: z.enum(['model', 'none']).optional(),
    })
    .strict(),
]);

export const maxPriceSchema = z
  .object({
    prompt: z.number().nonnegative().optional(),
    completion: z.number().nonnegative().optional(),
    request: z.number().nonnegative().optional(),
    image: z.number().nonnegative().optional(),
  })
  .strict();

export const providerConfigSchema = z
  .object({
    only: z.union([z.string(), z.array(z.string())]).optional(),
    order: z.union([z.string(), z.array(z.string())]).optional(),
    ignore: z.union([z.string(), z.array(z.string())]).optional(),
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

const triStateSchema = z.enum(['auto', 'always', 'never']);

export const modelOverrideSchema = z
  .object({
    provider: providerConfigSchema.optional(),
    headers: z.record(z.string(), z.string()).optional(),
    cacheControl: triStateSchema.optional(),
    cacheControlTtl: z.union([z.enum(['5m', '1h']), z.null()]).optional(),
    sessionId: triStateSchema.optional(),
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
    cacheControlTtl: z.enum(['5m', '1h']).optional(),
    sessionId: triStateSchema.default('auto'),
    modelOverrides: z.record(z.string().min(1), modelOverrideSchema).optional(),
  })
  .strict();

export const DEFAULTS = proxyConfigSchema.parse({});

export const proxyConfigFileSchema = proxyConfigSchema.partial();

export type ProxyConfig = z.infer<typeof proxyConfigSchema>;
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type ModelOverride = z.infer<typeof modelOverrideSchema>;
export type MaxPrice = z.infer<typeof maxPriceSchema>;
export type PercentileCutoffs = z.infer<typeof percentileCutoffsSchema>;
export type ProviderSort = z.infer<typeof providerSortSchema>;
export type AuthType = z.infer<typeof proxyConfigSchema>['authType'];

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

/**
 * Thrown when no config file is found via discovery and no explicit path was given.
 * Callers can `instanceof` this to surface a "create one?" prompt.
 */
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
