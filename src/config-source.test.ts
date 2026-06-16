import { describe, expect, it, vi } from 'vitest';
import { DEFAULTS, type LoadConfigOptions, type ProxyConfig } from './config.js';
import { createConfigSource, summarizeChanges } from './config-source.js';
import { logger } from './logger.js';

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

describe('FileWatchingConfigSource.reload', () => {
  const initial: ProxyConfig = { ...DEFAULTS };
  const loadOptions: LoadConfigOptions = { noConfig: true };

  it('applies a successfully loaded config', async () => {
    const load = vi.fn(async () => ({ ...initial, cacheControl: 'always' as const }));
    const source = createConfigSource({ loadOptions, initial, load });

    const result = await source.reload();

    expect(result).toEqual({ ok: true });
    expect(source.get().cacheControl).toBe('always');
  });

  it('keeps the previous config and reports the error on failure', async () => {
    const load = vi.fn().mockRejectedValue(new Error('cacheControl: bad value'));
    const source = createConfigSource({ loadOptions, initial, load });
    const before = source.get();

    const result = await source.reload();

    expect(result).toEqual({ ok: false, error: 'cacheControl: bad value' });
    expect(source.get()).toBe(before);
  });

  it('never rejects even when the loader throws a non-Error', async () => {
    const load = vi.fn(async () => {
      // biome-ignore lint/style/useThrowOnlyError: intentionally non-Error to test the catch branch
      throw 'string error';
    });
    const source = createConfigSource({ loadOptions, initial, load });

    await expect(source.reload()).resolves.toEqual({ ok: false, error: 'string error' });
  });

  it('re-reads after a change that lands during an in-flight reload (pending latch)', async () => {
    let resolveFirst: (cfg: ProxyConfig) => void = () => undefined;
    const first = new Promise<ProxyConfig>(resolve => {
      resolveFirst = resolve;
    });
    const load = vi
      .fn<(opts: LoadConfigOptions) => Promise<ProxyConfig>>()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({ ...initial, cacheControl: 'always' as const });
    const source = createConfigSource({ loadOptions, initial, load });

    const p1 = source.reload(); // in-flight
    void source.reload(); // arrives mid-flight → sets pending
    expect(load).toHaveBeenCalledTimes(1);

    resolveFirst({ ...initial, cacheControl: 'skip' as const });
    await p1;

    // pending triggers a second load after the first resolves
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(source.get().cacheControl).toBe('always'));
  });

  it('warns when host/port differ from the bound socket', async () => {
    const load = vi.fn(async () => ({ ...initial, port: initial.port + 1 }));
    const source = createConfigSource({ loadOptions, initial, load });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await source.reload();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('host/port changed — restart'),
    );
    warn.mockRestore();
  });
});
