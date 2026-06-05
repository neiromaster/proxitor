import { describe, expect, it, vi } from 'vitest';
import { OpenRouterDataClient } from '../../src/openrouter/data-client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeConfig = (overrides?: {
  openrouterDataUrl?: string;
  onFallback?: (path: string) => void;
}) => ({
  openrouterBaseUrl: 'https://custom.example.com/v1',
  apiKey: 'test-key',
  authType: 'bearer' as const,
  ...overrides,
});

const validProvidersResponse = () => ({
  data: [{ slug: 'openai', name: 'OpenAI' }],
});

const validModelsResponse = () => ({
  data: [{ id: 'openai/gpt-4o', name: 'GPT-4o' }],
});

const validEndpointsResponse = () => ({
  data: {
    endpoints: [{ model_name: 'gpt-4o', name: 'OpenAI', tag: 'openai' }],
  },
});

// ---------------------------------------------------------------------------
// Mock control — injected per test
// ---------------------------------------------------------------------------

let primaryGet: (path: string) => Promise<unknown> = async () => {
  throw new Error('not configured');
};
let fallbackGet: (path: string) => Promise<unknown> = async () => {
  throw new Error('not configured');
};

const setMockClients = (
  primary: (path: string) => Promise<unknown>,
  fallback: (path: string) => Promise<unknown>,
) => {
  primaryGet = primary;
  fallbackGet = fallback;
};

vi.mock('../../src/openrouter/client.js', () => {
  class MockClient {
    public readonly label: string;
    private readonly _get: (path: string) => Promise<unknown>;

    constructor(label: string, getFn: (path: string) => Promise<unknown>) {
      this.label = label;
      this._get = getFn;
    }

    async get<T>(path: string): Promise<T> {
      return this._get(path) as Promise<T>;
    }
  }

  return {
    OpenRouterClient: class extends MockClient {
      constructor(...args: [string, string?, string?]) {
        const isPrimary = args.length > 1;
        super(isPrimary ? 'primary' : 'fallback', isPrimary ? primaryGet : fallbackGet);
      }
    },
    OpenRouterClientError: class extends Error {
      readonly status: number;
      constructor(status: number, message: string) {
        super(`OpenRouter API error (${status}): ${message}`);
        this.name = 'OpenRouterClientError';
        this.status = status;
      }
    },
  };
});

const { OpenRouterClientError } = await import('../../src/openrouter/client.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenRouterDataClient', () => {
  describe('constructor', () => {
    it('uses openrouterBaseUrl as primary when openrouterDataUrl is not set', () => {
      const client = new OpenRouterDataClient(makeConfig());
      expect(client).toBeInstanceOf(OpenRouterDataClient);
    });

    it('skips fallback when primary equals OpenRouter', () => {
      const client = new OpenRouterDataClient({
        openrouterBaseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'test-key',
        authType: 'bearer',
      });
      expect(client).toBeInstanceOf(OpenRouterDataClient);
    });

    it('uses openrouterDataUrl as primary when set', () => {
      const client = new OpenRouterDataClient(
        makeConfig({ openrouterDataUrl: 'https://data.example.com/v1' }),
      );
      expect(client).toBeInstanceOf(OpenRouterDataClient);
    });

    it('accepts onFallback callback', () => {
      const onFallback = vi.fn();
      const client = new OpenRouterDataClient({ ...makeConfig(), onFallback });
      expect(client).toBeInstanceOf(OpenRouterDataClient);
    });
  });

  describe('withFallback — primary succeeds', () => {
    it('returns data when primary returns valid response', async () => {
      setMockClients(
        async () => validProvidersResponse(),
        async () => {
          throw new Error('fallback should not be called');
        },
      );

      const client = new OpenRouterDataClient(makeConfig());
      const providers = await client.fetchProviders();
      expect(providers).toEqual([{ slug: 'openai', name: 'OpenAI' }]);
    });

    it('does not call onFallback when primary succeeds', async () => {
      setMockClients(
        async () => validModelsResponse(),
        async () => {
          throw new Error('fallback should not be called');
        },
      );

      const onFallback = vi.fn();
      const client = new OpenRouterDataClient({ ...makeConfig(), onFallback });
      await client.fetchModels();
      expect(onFallback).not.toHaveBeenCalled();
    });

    it('works for fetchModelEndpoints when primary succeeds', async () => {
      setMockClients(
        async () => validEndpointsResponse(),
        async () => {
          throw new Error('fallback should not be called');
        },
      );

      const client = new OpenRouterDataClient(makeConfig());
      const endpoints = await client.fetchModelEndpoints('openai', 'gpt-4o');
      expect(endpoints).toEqual([
        { model_name: 'gpt-4o', name: 'OpenAI', tag: 'openai' },
      ]);
    });
  });

  describe('withFallback — fallback on HTTP errors', () => {
    it('falls back when primary returns 404', async () => {
      setMockClients(
        async () => {
          throw new OpenRouterClientError(404, 'Not Found');
        },
        async () => validProvidersResponse(),
      );

      const onFallback = vi.fn();
      const client = new OpenRouterDataClient({ ...makeConfig(), onFallback });
      const providers = await client.fetchProviders();

      expect(providers).toEqual([{ slug: 'openai', name: 'OpenAI' }]);
      expect(onFallback).toHaveBeenCalledWith('/providers');
    });

    it('falls back when primary returns 500', async () => {
      setMockClients(
        async () => {
          throw new OpenRouterClientError(500, 'Internal Server Error');
        },
        async () => validModelsResponse(),
      );

      const onFallback = vi.fn();
      const client = new OpenRouterDataClient({ ...makeConfig(), onFallback });
      const models = await client.fetchModels();

      expect(models).toEqual([{ id: 'openai/gpt-4o', name: 'GPT-4o' }]);
      expect(onFallback).toHaveBeenCalledWith('/models');
    });

    it('falls back when primary returns 429', async () => {
      setMockClients(
        async () => {
          throw new OpenRouterClientError(429, 'Too Many Requests');
        },
        async () => validEndpointsResponse(),
      );

      const onFallback = vi.fn();
      const client = new OpenRouterDataClient({ ...makeConfig(), onFallback });
      const endpoints = await client.fetchModelEndpoints('openai', 'gpt-4o');

      expect(endpoints).toEqual([
        { model_name: 'gpt-4o', name: 'OpenAI', tag: 'openai' },
      ]);
      expect(onFallback).toHaveBeenCalledWith('/models/openai/gpt-4o/endpoints');
    });
  });

  describe('withFallback — network errors with retry', () => {
    it('retries once on network error then returns primary data', async () => {
      let callCount = 0;
      setMockClients(
        async () => {
          callCount++;
          if (callCount === 1) throw new TypeError('fetch failed');
          return validProvidersResponse();
        },
        async () => {
          throw new Error('fallback should not be called');
        },
      );

      const onFallback = vi.fn();
      const client = new OpenRouterDataClient({ ...makeConfig(), onFallback });
      const providers = await client.fetchProviders();

      expect(providers).toEqual([{ slug: 'openai', name: 'OpenAI' }]);
      expect(onFallback).not.toHaveBeenCalled();
      expect(callCount).toBe(2);
    });

    it('falls back when primary returns network error twice', async () => {
      setMockClients(
        async () => {
          throw new TypeError('fetch failed');
        },
        async () => validProvidersResponse(),
      );

      const onFallback = vi.fn();
      const client = new OpenRouterDataClient({ ...makeConfig(), onFallback });
      const providers = await client.fetchProviders();

      expect(providers).toEqual([{ slug: 'openai', name: 'OpenAI' }]);
      expect(onFallback).toHaveBeenCalledWith('/providers');
    });

    it('falls back on ECONNREFUSED', async () => {
      setMockClients(
        async () => {
          throw new Error('ECONNREFUSED connection refused');
        },
        async () => validModelsResponse(),
      );

      const client = new OpenRouterDataClient(makeConfig());
      const models = await client.fetchModels();
      expect(models).toEqual([{ id: 'openai/gpt-4o', name: 'GPT-4o' }]);
    });

    it('falls back on ENOTFOUND', async () => {
      setMockClients(
        async () => {
          throw new Error('getaddrinfo ENOTFOUND bad-host');
        },
        async () => validModelsResponse(),
      );

      const client = new OpenRouterDataClient(makeConfig());
      const models = await client.fetchModels();
      expect(models).toEqual([{ id: 'openai/gpt-4o', name: 'GPT-4o' }]);
    });

    it('falls back on timeout', async () => {
      setMockClients(
        async () => {
          throw new Error('request timeout');
        },
        async () => validModelsResponse(),
      );

      const client = new OpenRouterDataClient(makeConfig());
      const models = await client.fetchModels();
      expect(models).toEqual([{ id: 'openai/gpt-4o', name: 'GPT-4o' }]);
    });

    it('falls back on aborted request', async () => {
      setMockClients(
        async () => {
          throw new Error('request aborted');
        },
        async () => validModelsResponse(),
      );

      const client = new OpenRouterDataClient(makeConfig());
      const models = await client.fetchModels();
      expect(models).toEqual([{ id: 'openai/gpt-4o', name: 'GPT-4o' }]);
    });

    it('falls back on generic network error', async () => {
      setMockClients(
        async () => {
          throw new Error('network error occurred');
        },
        async () => validModelsResponse(),
      );

      const client = new OpenRouterDataClient(makeConfig());
      const models = await client.fetchModels();
      expect(models).toEqual([{ id: 'openai/gpt-4o', name: 'GPT-4o' }]);
    });
  });

  describe('withFallback — invalid response format', () => {
    it('falls back when primary returns valid HTTP but wrong shape', async () => {
      setMockClients(
        async () => ({ unexpected: 'shape' }),
        async () => validProvidersResponse(),
      );

      const onFallback = vi.fn();
      const client = new OpenRouterDataClient({ ...makeConfig(), onFallback });
      const providers = await client.fetchProviders();

      expect(providers).toEqual([{ slug: 'openai', name: 'OpenAI' }]);
      expect(onFallback).toHaveBeenCalledWith('/providers');
    });

    it('falls back when primary returns null', async () => {
      setMockClients(
        async () => null,
        async () => validModelsResponse(),
      );

      const client = new OpenRouterDataClient(makeConfig());
      const models = await client.fetchModels();
      expect(models).toEqual([{ id: 'openai/gpt-4o', name: 'GPT-4o' }]);
    });

    it('falls back when primary returns empty object', async () => {
      setMockClients(
        async () => ({}),
        async () => validEndpointsResponse(),
      );

      const client = new OpenRouterDataClient(makeConfig());
      const endpoints = await client.fetchModelEndpoints('openai', 'gpt-4o');
      expect(endpoints).toEqual([
        { model_name: 'gpt-4o', name: 'OpenAI', tag: 'openai' },
      ]);
    });

    it('falls back when providers response has non-array data', async () => {
      setMockClients(
        async () => ({ data: 'not-an-array' }),
        async () => validProvidersResponse(),
      );

      const client = new OpenRouterDataClient(makeConfig());
      const providers = await client.fetchProviders();
      expect(providers).toEqual([{ slug: 'openai', name: 'OpenAI' }]);
    });

    it('falls back when endpoints response has non-array endpoints', async () => {
      setMockClients(
        async () => ({ data: { endpoints: 'not-an-array' } }),
        async () => validEndpointsResponse(),
      );

      const client = new OpenRouterDataClient(makeConfig());
      const endpoints = await client.fetchModelEndpoints('openai', 'gpt-4o');
      expect(endpoints).toEqual([
        { model_name: 'gpt-4o', name: 'OpenAI', tag: 'openai' },
      ]);
    });

    it('falls back when endpoints response has null data', async () => {
      setMockClients(
        async () => ({ data: null }),
        async () => validEndpointsResponse(),
      );

      const client = new OpenRouterDataClient(makeConfig());
      const endpoints = await client.fetchModelEndpoints('openai', 'gpt-4o');
      expect(endpoints).toEqual([
        { model_name: 'gpt-4o', name: 'OpenAI', tag: 'openai' },
      ]);
    });
  });

  describe('withFallback — skipFallback mode', () => {
    it('returns data directly when primary is OpenRouter and response is valid', async () => {
      setMockClients(
        async () => validProvidersResponse(),
        async () => {
          throw new Error('fallback should not be called');
        },
      );

      const client = new OpenRouterDataClient({
        openrouterBaseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'test-key',
        authType: 'bearer',
      });
      const providers = await client.fetchProviders();
      expect(providers).toEqual([{ slug: 'openai', name: 'OpenAI' }]);
    });

    it('throws when primary is OpenRouter and response format is invalid', async () => {
      setMockClients(
        async () => ({ wrong: 'shape' }),
        async () => {
          throw new Error('fallback should not be called');
        },
      );

      const client = new OpenRouterDataClient({
        openrouterBaseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'test-key',
        authType: 'bearer',
      });

      await expect(client.fetchProviders()).rejects.toThrow(
        'Unexpected response format from primary API for /providers',
      );
    });

    it('throws when primary is OpenRouter via openrouterDataUrl and response is invalid', async () => {
      setMockClients(
        async () => null,
        async () => {
          throw new Error('fallback should not be called');
        },
      );

      const client = new OpenRouterDataClient({
        openrouterBaseUrl: 'https://custom.example.com/v1',
        openrouterDataUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'test-key',
        authType: 'bearer',
      });

      await expect(client.fetchModels()).rejects.toThrow(
        'Unexpected response format from primary API for /models',
      );
    });
  });

  describe('withFallback — fallback also fails', () => {
    it('throws when primary fails and fallback returns invalid format', async () => {
      setMockClients(
        async () => {
          throw new Error('primary down');
        },
        async () => ({ wrong: 'shape' }),
      );

      const client = new OpenRouterDataClient(makeConfig());
      await expect(client.fetchProviders()).rejects.toThrow(
        'Unexpected response format from OpenRouter fallback for /providers',
      );
    });

    it('throws when primary and fallback both return invalid format', async () => {
      setMockClients(
        async () => ({ bad: 'primary' }),
        async () => ({ bad: 'fallback' }),
      );

      const client = new OpenRouterDataClient(makeConfig());
      await expect(client.fetchModels()).rejects.toThrow(
        'Unexpected response format from OpenRouter fallback for /models',
      );
    });

    it('retries primary once on network error before falling back', async () => {
      let callCount = 0;
      setMockClients(
        async () => {
          callCount++;
          throw new TypeError('fetch failed');
        },
        async () => null,
      );

      const client = new OpenRouterDataClient(makeConfig());
      await expect(client.fetchProviders()).rejects.toThrow(
        'Unexpected response format from OpenRouter fallback for /providers',
      );
      expect(callCount).toBe(2);
    });
  });

  describe('withFallback — onFallback callback', () => {
    it('calls onFallback with path for providers', async () => {
      setMockClients(
        async () => {
          throw new OpenRouterClientError(404, 'Not Found');
        },
        async () => validProvidersResponse(),
      );

      const onFallback = vi.fn();
      const client = new OpenRouterDataClient({ ...makeConfig(), onFallback });
      await client.fetchProviders();

      expect(onFallback).toHaveBeenCalledOnce();
      expect(onFallback).toHaveBeenCalledWith('/providers');
    });

    it('calls onFallback with path for models', async () => {
      setMockClients(
        async () => ({ bad: 'shape' }),
        async () => validModelsResponse(),
      );

      const onFallback = vi.fn();
      const client = new OpenRouterDataClient({ ...makeConfig(), onFallback });
      await client.fetchModels();

      expect(onFallback).toHaveBeenCalledOnce();
      expect(onFallback).toHaveBeenCalledWith('/models');
    });

    it('calls onFallback with path for model endpoints', async () => {
      setMockClients(
        async () => ({ bad: 'shape' }),
        async () => validEndpointsResponse(),
      );

      const onFallback = vi.fn();
      const client = new OpenRouterDataClient({ ...makeConfig(), onFallback });
      await client.fetchModelEndpoints('anthropic', 'claude-3');

      expect(onFallback).toHaveBeenCalledOnce();
      expect(onFallback).toHaveBeenCalledWith('/models/anthropic/claude-3/endpoints');
    });

    it('works without onFallback callback', async () => {
      setMockClients(
        async () => {
          throw new Error('primary down');
        },
        async () => validProvidersResponse(),
      );

      const client = new OpenRouterDataClient(makeConfig());
      const providers = await client.fetchProviders();
      expect(providers).toEqual([{ slug: 'openai', name: 'OpenAI' }]);
    });
  });
});
