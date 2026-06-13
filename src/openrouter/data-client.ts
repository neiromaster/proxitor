import { createHash } from 'node:crypto';
import type { AuthType } from '../config-schema.js';
import { OPENROUTER_API_URL } from '../config-schema.js';
import { formatAuthHeader } from '../utils.js';
import { OpenRouterClient } from './client.js';
import type { ModelEndpoint, OpenRouterModel, OpenRouterProvider } from './types.js';

const MODELS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
type CacheEntry = { at: number; models: OpenRouterModel[] };
const modelsCache = new Map<string, CacheEntry>();

export type DataClientConfig = {
  openrouterBaseUrl: string;
  openrouterDataUrl?: string;
  apiKey: string;
  authType: AuthType;
  onFallback?: (path: string) => void;
};

type FallbackResult<T> = {
  data: T;
  usedFallback: boolean;
};

function isValidArrayDataResponse<T>(data: unknown): data is { data: T[] } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'data' in data &&
    Array.isArray((data as { data: unknown }).data)
  );
}

function isValidProvidersResponse(data: unknown): data is { data: OpenRouterProvider[] } {
  return isValidArrayDataResponse(data);
}
function isValidModelsResponse(data: unknown): data is { data: OpenRouterModel[] } {
  return isValidArrayDataResponse(data);
}

function isValidEndpointsResponse(data: unknown): data is {
  data: { endpoints: ModelEndpoint[] };
} {
  return (
    typeof data === 'object' &&
    data !== null &&
    'data' in data &&
    typeof (data as { data: unknown }).data === 'object' &&
    (data as { data: unknown }).data !== null &&
    'endpoints' in ((data as { data: unknown }).data as object) &&
    Array.isArray((data as { data: { endpoints: unknown } }).data.endpoints)
  );
}

/** Fetches provider/model data with fallback to OpenRouter. */
export class OpenRouterDataClient {
  private primaryClient: OpenRouterClient;
  private fallbackClient: OpenRouterClient;
  private skipFallback: boolean;
  private onFallback?: (path: string) => void;
  private cacheKey: string;

  constructor(config: DataClientConfig) {
    const primaryUrl = config.openrouterDataUrl ?? config.openrouterBaseUrl;
    this.skipFallback = primaryUrl === OPENROUTER_API_URL;
    this.primaryClient = new OpenRouterClient(config.apiKey, primaryUrl, config.authType);
    this.fallbackClient = new OpenRouterClient(OPENROUTER_API_URL);
    this.onFallback = config.onFallback;
    // Isolate cache per credentials.
    const keyHash = createHash('sha256').update(config.apiKey).digest('hex').slice(0, 8);
    this.cacheKey = `${primaryUrl}|${config.authType}|${keyHash}`;
  }

  async fetchProviders(): Promise<OpenRouterProvider[]> {
    const result = await this.withFallback(
      '/v1/providers',
      () => this.primaryClient.get<unknown>('/v1/providers'),
      isValidProvidersResponse,
    );
    return result.data.data;
  }

  async fetchModels(): Promise<OpenRouterModel[]> {
    const cached = modelsCache.get(this.cacheKey);
    if (cached && Date.now() - cached.at < MODELS_CACHE_TTL_MS) {
      return cached.models;
    }
    const result = await this.withFallback(
      '/v1/models',
      () => this.primaryClient.get<unknown>('/v1/models'),
      isValidModelsResponse,
    );
    const models = result.data.data;
    modelsCache.set(this.cacheKey, { at: Date.now(), models });
    return models;
  }

  async fetchModelEndpoints(author: string, slug: string): Promise<ModelEndpoint[]> {
    const path = `/v1/models/${author}/${slug}/endpoints`;
    const result = await this.withFallback(
      path,
      () => this.primaryClient.get<unknown>(path),
      isValidEndpointsResponse,
    );
    return result.data.data.endpoints ?? [];
  }

  /** Primary with retry, then fallback. */
  private async withFallback<T>(
    path: string,
    primaryFn: () => Promise<unknown>,
    validate: (data: unknown) => data is T,
  ): Promise<FallbackResult<T>> {
    if (this.skipFallback) {
      const data = await primaryFn();
      if (!validate(data)) {
        throw new Error(`Unexpected response format from primary API for ${path}`);
      }
      return { data, usedFallback: false };
    }

    try {
      const data = await primaryFn();
      if (validate(data)) {
        return { data, usedFallback: false };
      }
    } catch (error) {
      if (error instanceof Error && isNetworkError(error)) {
        try {
          const data = await primaryFn();
          if (validate(data)) {
            return { data, usedFallback: false };
          }
        } catch {
          // retry also failed
        }
      }
    }

    this.onFallback?.(path);
    const data = await this.fallbackClient.get<unknown>(path);
    if (!validate(data)) {
      throw new Error(`Unexpected response format from OpenRouter fallback for ${path}`);
    }
    return { data, usedFallback: true };
  }
}

function isNetworkError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('fetch') ||
    message.includes('network') ||
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('timeout') ||
    message.includes('aborted') ||
    error.name === 'TypeError'
  );
}

export function clearModelsCache(): void {
  modelsCache.clear();
}

/** Probes upstream to validate key and count models. */
export async function probeUpstream(
  baseUrl: string,
  apiKey: string,
  authType: AuthType,
  timeoutMs = 3_000,
): Promise<{ ok: true; modelCount: number } | { ok: false; reason: string }> {
  if (!apiKey) {
    return { ok: false, reason: 'No API key provided' };
  }
  const url = `${baseUrl.replace(/\/$/, '')}/v1/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Authorization: formatAuthHeader(apiKey, authType) },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: `Key rejected (${res.status})` };
    }
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}` };
    }
    const body = (await res.json().catch(() => null)) as { data?: unknown[] } | null;
    return { ok: true, modelCount: Array.isArray(body?.data) ? body.data.length : 0 };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
