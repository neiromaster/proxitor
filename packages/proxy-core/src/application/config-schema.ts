import { WIRE_FORMATS } from '@proxitor/plugin-api';
import { z } from 'zod';
import type { ModelBinding, PluginListEntry, ProviderConfig } from '../domain/index.js';

/** Load-time config failure (spec §6): fail-loud, aborts startup. */
export class ConfigError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ConfigError';
  }
}

export type ProxyConfig = z.infer<typeof ProxyConfigSchema>;
export type ServerConfig = z.infer<typeof ServerSchema>;
export type ObservabilityConfig = z.infer<typeof ObservabilitySchema>;
export type ControlPlaneConfig = z.infer<typeof ControlPlaneSchema>;

const CredentialRefSchema = z.union([
  z.string(),
  z.object({ env: z.string().min(1) }),
  z.object({ file: z.string().min(1) }),
]);

const PluginListSchema = z.array(
  z.union([z.string().min(1), z.record(z.string(), z.unknown())]),
);

const AuthSchema = z.object({
  type: z.enum(['bearer', 'x-api-key', 'header', 'none']),
  credential: CredentialRefSchema,
  headerName: z.string().min(1).optional(),
});

const ProviderInputSchema = z.object({
  baseUrl: z.string().min(1),
  wireFormat: z.enum(WIRE_FORMATS),
  auth: AuthSchema,
  headers: z.record(z.string(), z.string()).optional(),
  plugins: PluginListSchema.optional(),
  unsupportedParams: z.enum(['error', 'drop']).optional(),
  maxTokensField: z.enum(['auto', 'max_tokens', 'max_completion_tokens']).optional(),
});

/** Provider record: the YAML key IS the provider id (spec §6). */
const ProvidersSchema = z
  .record(z.string().min(1), ProviderInputSchema)
  .transform(record => {
    const providers: Record<string, ProviderConfig> = {};
    for (const [key, value] of Object.entries(record)) {
      providers[key] = { ...value, id: key };
    }
    return providers;
  })
  .refine(providers => Object.keys(providers).length > 0, {
    message: 'providers must declare at least one provider',
  });

const ModelsSchema = z
  .array(
    z.object({
      match: z.string().min(1),
      provider: z.string().min(1),
      modelId: z.string().min(1),
      plugins: PluginListSchema.optional(),
    }),
  )
  .min(1, 'models must declare at least one binding');

const BYTES_RE = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?\s*$/i;
type BodyLimitUnit = 'b' | 'kb' | 'mb' | 'gb';
const UNIT_BYTES: Readonly<Record<BodyLimitUnit, number>> = {
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
};

function parseBodyLimit(value: string | number): number {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value <= 0) {
      throw new ConfigError(`server.bodyLimit: invalid byte count ${value}`);
    }
    return value;
  }
  const match = BYTES_RE.exec(value);
  if (match === null) {
    throw new ConfigError(
      `server.bodyLimit: cannot parse "${value}" (expected e.g. "50mb" or a byte number)`,
    );
  }
  const num = Number(match[1]); // match[1] is required by the regex
  const unit = match[2] === undefined ? 'b' : (match[2].toLowerCase() as BodyLimitUnit);
  const bytes = Math.round(num * UNIT_BYTES[unit]);
  if (!Number.isInteger(bytes) || bytes <= 0) {
    throw new ConfigError(`server.bodyLimit: invalid byte count ${value}`);
  }
  return bytes;
}

const ServerSchema = z.preprocess(
  val => val ?? {},
  z
    .object({
      host: z.string().min(1).optional(),
      port: z.number().int().min(1).max(65_535).optional(),
      bodyLimit: z.union([z.string(), z.number()]).optional(),
      forwardHeaders: z.array(z.string().min(1)).optional(),
    })
    .transform(v => ({
      host: v.host ?? '127.0.0.1',
      port: v.port ?? 8828,
      bodyLimitBytes: parseBodyLimit(v.bodyLimit ?? '50mb'),
      forwardHeaders: v.forwardHeaders ?? [],
    })),
);

const ObservabilitySchema = z.preprocess(
  val => val ?? {},
  z
    .object({
      routerMetadata: z.boolean().optional(),
      hitThreshold: z.number().int().min(0).max(100).optional(),
      sessionMaxEntries: z.number().int().positive().optional(),
    })
    .transform(v => ({
      routerMetadata: v.routerMetadata ?? true,
      hitThreshold: v.hitThreshold ?? 80,
      sessionMaxEntries: v.sessionMaxEntries ?? 4096,
    })),
);

const ControlPlaneSchema = z.preprocess(
  val => val ?? undefined,
  z.object({ token: CredentialRefSchema }).optional(),
);

const LoggingSchema = z.preprocess(
  val => val ?? {},
  z
    .object({ verbose: z.boolean().optional() })
    .transform(v => ({ verbose: v.verbose ?? false })),
);

const ProxyConfigSchema = z.object({
  version: z.literal(1),
  plugins: PluginListSchema.optional(),
  providers: ProvidersSchema,
  models: ModelsSchema,
  defaultProvider: z.string().min(1).optional(),
  observability: ObservabilitySchema,
  controlPlane: ControlPlaneSchema,
  server: ServerSchema,
  logging: LoggingSchema,
});

/** Parse + validate raw config data (spec §6). Throws ConfigError with issue paths. */
export function parseConfig(input: unknown): ProxyConfig {
  const result = ProxyConfigSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new ConfigError(`invalid config: ${issues}`);
  }
  return result.data;
}

/** D16: credentials never reach logs — clone with every credential replaced. */
export function redactConfigForLog(config: ProxyConfig): ProxyConfig {
  const REDACTED = '[redacted]'; // a plain string is itself a valid CredentialRef
  const providers: Record<string, ProviderConfig> = {};
  for (const [key, provider] of Object.entries(config.providers)) {
    providers[key] = { ...provider, auth: { ...provider.auth, credential: REDACTED } };
  }
  return {
    ...config,
    providers,
    controlPlane: config.controlPlane === undefined ? undefined : { token: REDACTED },
  };
}

export type { ModelBinding, PluginListEntry };
