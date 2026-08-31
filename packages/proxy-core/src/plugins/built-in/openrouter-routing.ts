import type { CanonicalRequest, ProxyPlugin } from '@proxitor/plugin-api';
import { definePlugin } from '@proxitor/plugin-api';
import { z } from 'zod';

/**
 * OpenRouter provider routing hints through the reserved-key channel (D18,
 * spec §4.3): writes `extensions['openai-chat']['$proxitor.provider']`; the
 * openai-chat encoder maps it onto the wire body after the passthrough merge.
 * Hard-gated to openai-chat routes via reservedKeys (§4.3). Port of legacy
 * buildProviderRouting + providerConfigSchema.
 */
const percentileCutoffsSchema = z
  .object({
    p50: z.number().positive().optional(),
    p75: z.number().positive().optional(),
    p90: z.number().positive().optional(),
    p99: z.number().positive().optional(),
  })
  .strict();

const sortSchema = z.union([
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

const stringOrArray = z.union([z.string(), z.array(z.string())]);

const routingConfigSchema = z
  .object({
    only: stringOrArray.optional(),
    order: stringOrArray.optional(),
    ignore: stringOrArray.optional(),
    allowFallbacks: z.boolean().optional(),
    sort: sortSchema.optional(),
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
  .strict()
  .default({});

export type OpenRouterRoutingConfig = z.infer<typeof routingConfigSchema>;

const ARRAY_FIELDS = [
  { key: 'only', apiName: 'only' },
  { key: 'order', apiName: 'order' },
  { key: 'ignore', apiName: 'ignore' },
  { key: 'quantizations', apiName: 'quantizations' },
] as const;

const DIRECT_FIELDS = [
  { key: 'sort', apiName: 'sort' },
  { key: 'maxPrice', apiName: 'max_price' },
  { key: 'requireParameters', apiName: 'require_parameters' },
  { key: 'dataCollection', apiName: 'data_collection' },
  { key: 'zdr', apiName: 'zdr' },
  { key: 'enforceDistillableText', apiName: 'enforce_distillable_text' },
  { key: 'preferredMinThroughput', apiName: 'preferred_min_throughput' },
  { key: 'preferredMaxLatency', apiName: 'preferred_max_latency' },
] as const;

/** Config → OpenRouter wire `provider` object; undefined when no hints configured. */
export function buildProviderRouting(
  config: OpenRouterRoutingConfig,
): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {};
  for (const { key, apiName } of ARRAY_FIELDS) {
    const value = config[key];
    if (value === undefined) continue;
    const normalized = Array.isArray(value) ? value : [value];
    if (normalized.length > 0) result[apiName] = normalized;
  }
  for (const { key, apiName } of DIRECT_FIELDS) {
    const value = config[key];
    if (value !== undefined) result[apiName] = value;
  }
  if (result.order !== undefined) result.allow_fallbacks = config.allowFallbacks ?? true;
  return Object.keys(result).length > 0 ? result : undefined;
}

export function createOpenRouterRoutingPlugin(): ProxyPlugin<OpenRouterRoutingConfig> {
  return definePlugin(routingConfigSchema, {
    name: 'openrouter-routing',
    reservedKeys: { 'openai-chat': ['$proxitor.provider'] },
    onRequest(ctx, req: CanonicalRequest) {
      const routing = buildProviderRouting(ctx.config);
      if (routing === undefined) return req;
      const bag = {
        // biome-ignore lint/suspicious/noUnnecessaryConditions: key can be absent under noUncheckedIndexedAccess
        ...(req.extensions['openai-chat'] ?? {}),
        '$proxitor.provider': routing,
      };
      return { ...req, extensions: { ...req.extensions, 'openai-chat': bag } };
    },
  });
}
