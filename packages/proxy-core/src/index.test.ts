import { describe, expect, it } from 'vitest';
import {
  buildUpstreamHeaders,
  createPipeline,
  createPluginManager,
  createProxitor,
  createRoutingTable,
  mergePluginLayers,
  PROXY_CORE_PLACEHOLDER,
  validateProvider,
} from './index.js';

describe('proxy-core package', () => {
  it('loads its placeholder export', () => {
    expect(PROXY_CORE_PLACEHOLDER).toBe(true);
  });
});

describe('composition root re-exports', () => {
  it('exposes the composition root from the package root', () => {
    // Arrange / Act / Assert
    expect(typeof createProxitor).toBe('function');
  });
});

describe('domain routing re-exports', () => {
  it('exposes the routing surface from the package root', () => {
    // Arrange / Act / Assert
    expect(typeof createRoutingTable).toBe('function');
    expect(typeof mergePluginLayers).toBe('function');
    expect(typeof validateProvider).toBe('function');
  });
});

describe('application re-exports', () => {
  it('exposes the pipeline surface from the package root', () => {
    // Arrange / Act / Assert
    expect(typeof createPipeline).toBe('function');
    expect(typeof createPluginManager).toBe('function');
    expect(typeof buildUpstreamHeaders).toBe('function');
  });
});

describe('built-in plugin exports', () => {
  it('exports the built-in plugin factories and registry', async () => {
    const core = await import('./index.js');
    expect(typeof core.createBuiltInPluginRegistry).toBe('function');
    expect(typeof core.createCacheControlPlugin).toBe('function');
    expect(typeof core.createNormalizeVolatileSystemPlugin).toBe('function');
    expect(typeof core.createSessionIdPlugin).toBe('function');
    expect(typeof core.createOpenRouterRoutingPlugin).toBe('function');
  });
});
