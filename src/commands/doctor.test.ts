import { describe, expect, it } from 'vitest';
// checkSlugCollisions is private; assert the detection it uses instead.
import { detectSlugCollisions, formatSlugCollisionWarning } from '../config.js';
import type { ProxyConfig } from '../config-schema.js';
import { DEFAULTS } from '../config-schema.js';

describe('doctor slug-collision check (data)', () => {
  it('flags same-slug overrides', () => {
    const cfg = {
      ...DEFAULTS,
      openrouterKey: 'sk-test',
      modelOverrides: { 'openai/gpt-4o': {}, 'azure/gpt-4o': {} },
    } as unknown as ProxyConfig;
    const collisions = detectSlugCollisions(cfg.modelOverrides);
    expect(collisions).toHaveLength(1);
    expect(formatSlugCollisionWarning(collisions[0]!)).toContain(
      'share model slug "gpt-4o"',
    );
  });

  it('passes when slugs are unique', () => {
    const cfg = {
      ...DEFAULTS,
      openrouterKey: 'sk-test',
      modelOverrides: { 'openai/gpt-4o': {}, 'anthropic/claude-4': {} },
    } as unknown as ProxyConfig;
    expect(detectSlugCollisions(cfg.modelOverrides)).toEqual([]);
  });
});
