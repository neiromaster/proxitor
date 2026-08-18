import { describe, expect, it } from 'vitest';
import { PLUGIN_API_VERSION } from './index.js';

describe('plugin-api package', () => {
  it('exposes its version', () => {
    expect(PLUGIN_API_VERSION).toBe('0.0.0');
  });
});
