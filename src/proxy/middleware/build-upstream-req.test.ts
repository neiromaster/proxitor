import { describe, expect, it } from 'vitest';
import { withRouterMetadata } from './build-upstream-req.js';

describe('withRouterMetadata', () => {
  it('adds the metadata header when enabled', () => {
    expect(withRouterMetadata({}, true)).toEqual({
      'x-openrouter-metadata': 'enabled',
    });
  });

  it('omits the metadata header when disabled', () => {
    expect(withRouterMetadata({}, false)).toEqual({});
  });

  it('preserves existing headers when enabled', () => {
    expect(withRouterMetadata({ authorization: 'Bearer x' }, true)).toEqual({
      authorization: 'Bearer x',
      'x-openrouter-metadata': 'enabled',
    });
  });
});
