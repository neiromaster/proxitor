import { describe, expect, it } from 'vitest';
import {
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

describe('domain routing re-exports', () => {
  it('exposes the routing surface from the package root', () => {
    // Arrange / Act / Assert
    expect(typeof createRoutingTable).toBe('function');
    expect(typeof mergePluginLayers).toBe('function');
    expect(typeof validateProvider).toBe('function');
  });
});
