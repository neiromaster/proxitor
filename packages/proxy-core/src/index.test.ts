import { describe, expect, it } from 'vitest';
import { PROXY_CORE_PLACEHOLDER } from './index.js';

describe('proxy-core package', () => {
  it('loads its placeholder export', () => {
    expect(PROXY_CORE_PLACEHOLDER).toBe(true);
  });
});
