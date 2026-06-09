import { describe, expect, it } from 'vitest';
import { maskKey } from '../../src/commands/config/wizard.js';

describe('maskKey', () => {
  it('returns "(none)" for empty string', () => {
    expect(maskKey('')).toBe('(none)');
  });

  it('masks short keys (≤11 chars) with asterisks', () => {
    expect(maskKey('short-key')).toBe('****');
  });

  it('masks at boundary exactly 11 chars', () => {
    expect(maskKey('12345678901')).toBe('****');
  });

  it('truncates long keys showing first 7 and last 4', () => {
    expect(maskKey('sk-or-v1-abcdefghijklmnop')).toBe('sk-or-v…mnop');
  });

  it('truncates at boundary 12 chars', () => {
    expect(maskKey('123456789012')).toBe('1234567…9012');
  });
});
