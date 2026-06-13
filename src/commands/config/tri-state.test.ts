import { describe, expect, it } from 'vitest';
import { applyField } from './tri-state.js';

describe('applyField', () => {
  it('sets the value when field is { value }', () => {
    const obj: Record<string, unknown> = {};
    applyField(obj, 'cacheControl', { value: 'always' });
    expect(obj.cacheControl).toBe('always');
  });

  it('removes the key when field is { remove: true }', () => {
    const obj: Record<string, unknown> = { cacheControl: 'always' };
    applyField(obj, 'cacheControl', { remove: true });
    expect(obj).not.toHaveProperty('cacheControl');
  });

  it('keeps the existing value when field is undefined', () => {
    const obj: Record<string, unknown> = { cacheControl: 'always' };
    applyField(obj, 'cacheControl', undefined);
    expect(obj.cacheControl).toBe('always');
  });

  it('overwrites an existing value when setting', () => {
    const obj: Record<string, unknown> = { cacheControlTtl: '5m' };
    applyField(obj, 'cacheControlTtl', { value: '1h' });
    expect(obj.cacheControlTtl).toBe('1h');
  });

  it('removes a stale value then sets a new one', () => {
    const obj: Record<string, unknown> = { cacheControlTtl: '5m' };
    applyField(obj, 'cacheControlTtl', undefined);
    applyField(obj, 'cacheControlTtl', { value: 'omit' });
    expect(obj.cacheControlTtl).toBe('omit');
  });
});
