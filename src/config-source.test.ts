import { describe, expect, it } from 'vitest';
import { DEFAULTS, type ProxyConfig } from './config.js';
import { summarizeChanges } from './config-source.js';

const base = (): ProxyConfig => ({ ...DEFAULTS });

describe('summarizeChanges', () => {
  it('returns empty string when nothing material changed', () => {
    expect(summarizeChanges(base(), base())).toBe('');
  });

  it('reports a scalar field change', () => {
    const prev = base();
    const next: ProxyConfig = { ...base(), cacheControl: 'always' };
    expect(summarizeChanges(prev, next)).toBe('cacheControl: auto→always');
  });

  it('formats booleans as on/off', () => {
    const prev = base();
    const next: ProxyConfig = { ...base(), normalizeVolatileSystem: true };
    expect(summarizeChanges(prev, next)).toBe('normalizeVolatileSystem: off→on');
  });

  it('formats undefined as unset', () => {
    const prev = base();
    const next: ProxyConfig = { ...base(), cacheControlTtl: '5m' };
    expect(summarizeChanges(prev, next)).toBe('cacheControlTtl: unset→5m');
  });

  it('reports provider routing change', () => {
    const prev = base();
    const next: ProxyConfig = { ...base(), provider: { only: 'anthropic' } };
    expect(summarizeChanges(prev, next)).toBe('provider routing');
  });

  it('reports modelOverrides count change', () => {
    const prev = base();
    const next: ProxyConfig = {
      ...base(),
      modelOverrides: { 'claude-*': { cacheControl: 'always' } },
    };
    expect(summarizeChanges(prev, next)).toBe('modelOverrides: 0→1');
  });

  it('reports headers change', () => {
    const prev = base();
    const next: ProxyConfig = { ...base(), headers: { 'X-Test': '1' } };
    expect(summarizeChanges(prev, next)).toBe('headers');
  });

  it('reports modelOverrides value change when the key set is unchanged', () => {
    const prev: ProxyConfig = {
      ...base(),
      modelOverrides: { 'claude-*': { cacheControl: 'auto' } },
    };
    const next: ProxyConfig = {
      ...base(),
      modelOverrides: { 'claude-*': { cacheControl: 'always' } },
    };
    expect(summarizeChanges(prev, next)).toBe('modelOverrides: 1→1');
  });

  it('does not report headers change when only key order differs', () => {
    const prev: ProxyConfig = { ...base(), headers: { 'X-A': '1', 'X-B': '2' } };
    const next: ProxyConfig = { ...base(), headers: { 'X-B': '2', 'X-A': '1' } };
    expect(summarizeChanges(prev, next)).toBe('');
  });

  it('joins multiple changes with a comma', () => {
    const prev = base();
    const next: ProxyConfig = {
      ...base(),
      cacheControl: 'always',
      normalizeVolatileSystem: true,
    };
    expect(summarizeChanges(prev, next)).toBe(
      'cacheControl: auto→always, normalizeVolatileSystem: off→on',
    );
  });
});
