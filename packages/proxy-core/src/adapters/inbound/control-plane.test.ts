import { describe, expect, it } from 'vitest';
import type { ProxyConfig } from '../../application/config-schema.js';
import { createControlPlaneApp, routingViewOf } from './control-plane.js';

describe('control-plane', () => {
  const mockReload = () =>
    Promise.resolve({
      ok: true,
      changes: 'providers, models',
    } as const);

  const mockRoutingView = () => ({
    providers: [
      { id: 'test-provider', baseUrl: 'https://example.com', wireFormat: 'anthropic' },
    ],
    models: [
      { match: 'claude-*', provider: 'test-provider', modelId: 'claude-3-5-sonnet' },
    ],
    defaultProvider: 'test-provider',
  });

  const validToken = 'test-secret-token';

  describe('authentication', () => {
    it('should return 401 when no Authorization header is provided', async () => {
      const app = createControlPlaneApp({
        getToken: () => validToken,
        reload: mockReload,
        routingView: mockRoutingView,
      });

      const res = await app.request('/routing', {
        method: 'GET',
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({
        error: { message: 'unauthorized', type: 'invalid_request_error' },
      });
    });

    it('should return 401 when wrong token is provided', async () => {
      const app = createControlPlaneApp({
        getToken: () => validToken,
        reload: mockReload,
        routingView: mockRoutingView,
      });

      const res = await app.request('/routing', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer wrong-token',
        },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({
        error: { message: 'unauthorized', type: 'invalid_request_error' },
      });
    });

    it('should return 401 when non-Bearer scheme is used', async () => {
      const app = createControlPlaneApp({
        getToken: () => validToken,
        reload: mockReload,
        routingView: mockRoutingView,
      });

      const res = await app.request('/routing', {
        method: 'GET',
        headers: {
          Authorization: 'Basic dGVzdDp0ZXN0',
        },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({
        error: { message: 'unauthorized', type: 'invalid_request_error' },
      });
    });

    it('should pass authentication with correct token', async () => {
      const app = createControlPlaneApp({
        getToken: () => validToken,
        reload: mockReload,
        routingView: mockRoutingView,
      });

      const res = await app.request('/routing', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${validToken}`,
        },
      });

      expect(res.status).toBe(200);
    });

    it('should return 404 with the proxy not-found shape when getToken returns undefined', async () => {
      const app = createControlPlaneApp({
        getToken: () => undefined,
        reload: mockReload,
        routingView: mockRoutingView,
      });

      const res = await app.request('/reload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validToken}`,
        },
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toEqual({
        error: { message: "unknown path '/reload'", type: 'invalid_request_error' },
      });
    });

    it('should consult getToken per request — rotated token works, old token 401s', async () => {
      // Arrange — token source that rotates between requests
      let currentToken: string | undefined = 'old-secret';
      const app = createControlPlaneApp({
        getToken: () => currentToken,
        reload: mockReload,
        routingView: mockRoutingView,
      });

      const withBearer = (token: string): RequestInit => ({
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      // Sanity: old token accepted before rotation
      const before = await app.request('/routing', withBearer('old-secret'));
      expect(before.status).toBe(200);

      // Act — rotate the token
      currentToken = 'new-secret';

      // Assert — new token accepted, old token rejected
      const afterNew = await app.request('/routing', withBearer('new-secret'));
      expect(afterNew.status).toBe(200);
      const afterOld = await app.request('/routing', withBearer('old-secret'));
      expect(afterOld.status).toBe(401);
    });

    it('should return 404 (not 405) when getToken returns undefined — unmounted check runs before method guards', async () => {
      const app = createControlPlaneApp({
        getToken: () => undefined,
        reload: mockReload,
        routingView: mockRoutingView,
      });

      const res = await app.request('/reload', {
        method: 'GET',
      });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /reload', () => {
    it('should return 200 with ok:true on successful reload', async () => {
      const app = createControlPlaneApp({
        getToken: () => validToken,
        reload: mockReload,
        routingView: mockRoutingView,
      });

      const res = await app.request('/reload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validToken}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        ok: true,
        changes: 'providers, models',
      });
    });

    it('should return 400 with ok:false on reload error', async () => {
      const failingReload = () =>
        Promise.resolve({
          ok: false,
          error: 'Config parse error: invalid YAML',
        } as const);

      const app = createControlPlaneApp({
        getToken: () => validToken,
        reload: failingReload,
        routingView: mockRoutingView,
      });

      const res = await app.request('/reload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validToken}`,
        },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toEqual({
        ok: false,
        error: 'Config parse error: invalid YAML',
      });
    });

    it('should return 405 for GET /reload', async () => {
      const app = createControlPlaneApp({
        getToken: () => validToken,
        reload: mockReload,
        routingView: mockRoutingView,
      });

      const res = await app.request('/reload', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${validToken}`,
        },
      });

      expect(res.status).toBe(405);
    });
  });

  describe('GET /routing', () => {
    it('should return 200 with routing view', async () => {
      const expectedView = {
        providers: [
          {
            id: 'test-provider',
            baseUrl: 'https://example.com',
            wireFormat: 'anthropic',
          },
        ],
        models: [
          { match: 'claude-*', provider: 'test-provider', modelId: 'claude-3-5-sonnet' },
        ],
        defaultProvider: 'test-provider',
      };

      const app = createControlPlaneApp({
        getToken: () => validToken,
        reload: mockReload,
        routingView: () => expectedView,
      });

      const res = await app.request('/routing', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${validToken}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual(expectedView);
    });

    it('should return 405 for POST /routing', async () => {
      const app = createControlPlaneApp({
        getToken: () => validToken,
        reload: mockReload,
        routingView: mockRoutingView,
      });

      const res = await app.request('/routing', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validToken}`,
        },
      });

      expect(res.status).toBe(405);
    });
  });

  describe('method guards', () => {
    it('should return 405 for PUT /reload', async () => {
      const app = createControlPlaneApp({
        getToken: () => validToken,
        reload: mockReload,
        routingView: mockRoutingView,
      });

      const res = await app.request('/reload', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${validToken}`,
        },
      });

      expect(res.status).toBe(405);
    });

    it('should return 405 for DELETE /routing', async () => {
      const app = createControlPlaneApp({
        getToken: () => validToken,
        reload: mockReload,
        routingView: mockRoutingView,
      });

      const res = await app.request('/routing', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${validToken}`,
        },
      });

      expect(res.status).toBe(405);
    });

    it('should return 401 for unauthorized PUT /reload', async () => {
      const app = createControlPlaneApp({
        getToken: () => validToken,
        reload: mockReload,
        routingView: mockRoutingView,
      });

      const res = await app.request('/reload', {
        method: 'PUT',
      });

      expect(res.status).toBe(401);
    });

    it('should return 401 (not 405) for unauthorized GET /reload — auth runs before method guards', async () => {
      const app = createControlPlaneApp({
        getToken: () => validToken,
        reload: mockReload,
        routingView: mockRoutingView,
      });

      const res = await app.request('/reload', {
        method: 'GET',
        // No Authorization header
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({
        error: { message: 'unauthorized', type: 'invalid_request_error' },
      });
    });

    it('should return 401 (not 405) for unauthorized POST /routing — auth runs before method guards', async () => {
      const app = createControlPlaneApp({
        getToken: () => validToken,
        reload: mockReload,
        routingView: mockRoutingView,
      });

      const res = await app.request('/routing', {
        method: 'POST',
        // No Authorization header
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({
        error: { message: 'unauthorized', type: 'invalid_request_error' },
      });
    });
  });
});

describe('routingViewOf', () => {
  const fullConfig: ProxyConfig = {
    version: 1,
    providers: {
      anthropic: {
        id: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        wireFormat: 'anthropic-messages',
        auth: {
          type: 'bearer',
          credential: 'sk-ant-key',
        },
        headers: { 'X-Custom': 'value' },
        plugins: ['retry'],
      },
      openai: {
        id: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        wireFormat: 'openai-chat',
        auth: {
          type: 'bearer',
          credential: { env: 'OPENAI_API_KEY' },
        },
      },
    },
    models: [
      {
        match: 'claude-*',
        provider: 'anthropic',
        modelId: 'claude-3-5-sonnet-20241022',
        plugins: [{ name: 'cache-control', config: { threshold: 100 } }],
      },
      {
        match: 'gpt-*',
        provider: 'openai',
        modelId: 'gpt-4',
      },
    ],
    defaultProvider: 'anthropic',
    plugins: ['observability'],
    observability: {
      routerMetadata: true,
      hitThreshold: 80,
      sideMaxTokens: 4096,
      sessionMaxEntries: 4096,
      sessionTtlMs: 600000,
    },
    controlPlane: {
      token: { env: 'CONTROL_TOKEN' },
    },
    server: {
      host: '127.0.0.1',
      port: 8828,
      bodyLimitBytes: 52428800,
      forwardHeaders: ['x-request-id'],
    },
    logging: {
      verbose: false,
    },
  };

  it('should extract only safe fields from config', () => {
    const view = routingViewOf(fullConfig);

    // Providers: only id, baseUrl, wireFormat, plugins
    expect(view.providers).toHaveLength(2);
    expect(view.providers).toEqual([
      {
        id: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        wireFormat: 'anthropic-messages',
        plugins: ['retry'],
      },
      {
        id: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        wireFormat: 'openai-chat',
      },
    ]);

    // Models: match, provider, modelId, plugins
    expect(view.models).toHaveLength(2);
    expect(view.models).toEqual([
      {
        match: 'claude-*',
        provider: 'anthropic',
        modelId: 'claude-3-5-sonnet-20241022',
        plugins: [{ name: 'cache-control', config: { threshold: 100 } }],
      },
      {
        match: 'gpt-*',
        provider: 'openai',
        modelId: 'gpt-4',
      },
    ]);

    expect(view.defaultProvider).toBe('anthropic');
    expect(view.plugins).toEqual(['observability']);
  });

  it('should not include sensitive fields in output', () => {
    const view = routingViewOf(fullConfig);
    const json = JSON.stringify(view);

    // These keys should never appear
    expect(json).not.toContain('auth');
    expect(json).not.toContain('credential');
    expect(json).not.toContain('headers');
    expect(json).not.toContain('sk-ant-key');
    expect(json).not.toContain('X-Custom');

    // Deep scan: check each provider object
    for (const provider of view.providers) {
      expect('auth' in provider).toBe(false);
      expect('credential' in provider).toBe(false);
      expect('headers' in provider).toBe(false);
    }

    // Check each model object
    for (const model of view.models) {
      expect('auth' in model).toBe(false);
      expect('credential' in model).toBe(false);
    }
  });

  it('should omit optional plugins when absent', () => {
    const minimalConfig: ProxyConfig = {
      version: 1,
      providers: {
        minimal: {
          id: 'minimal',
          baseUrl: 'https://api.example.com',
          wireFormat: 'anthropic-messages',
          auth: { type: 'none', credential: '' },
        },
      },
      models: [
        {
          match: '*',
          provider: 'minimal',
          modelId: 'model',
        },
      ],
      observability: {
        routerMetadata: true,
        hitThreshold: 80,
        sideMaxTokens: 4096,
        sessionMaxEntries: 4096,
        sessionTtlMs: 600000,
      },
      controlPlane: undefined,
      server: {
        host: '127.0.0.1',
        port: 8828,
        bodyLimitBytes: 52428800,
        forwardHeaders: [],
      },
      logging: {
        verbose: false,
      },
    };

    const view = routingViewOf(minimalConfig);

    // Provider without plugins should not have the key
    expect(view.providers[0]).not.toHaveProperty('plugins');

    // Model without plugins should not have the key
    expect(view.models[0]).not.toHaveProperty('plugins');

    // Top-level plugins undefined when absent
    expect(view).not.toHaveProperty('plugins');

    // defaultProvider undefined when absent
    expect(view).not.toHaveProperty('defaultProvider');
  });

  it('should pass through plugins arrays verbatim as unknown', () => {
    const view = routingViewOf(fullConfig);

    // Provider plugins should pass through
    const providerWithPlugins = view.providers.find(p => p.id === 'anthropic');
    expect(providerWithPlugins?.plugins).toEqual(['retry']);

    // Model plugins should pass through
    const modelWithPlugins = view.models.find(m => m.match === 'claude-*');
    expect(modelWithPlugins?.plugins).toEqual([
      { name: 'cache-control', config: { threshold: 100 } },
    ]);
  });
});
