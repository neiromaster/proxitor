import { describe, expect, it } from 'vitest';
import { maskKey } from '../../src/commands/config/prompts.js';
import { formatPreviewHeader } from '../../src/commands/config/wizard.js';

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

describe('formatPreviewHeader', () => {
  it('renders base URL and Bearer token label (defaults)', () => {
    expect(formatPreviewHeader('https://openrouter.ai/api', 'bearer')).toBe(
      'Base URL:  https://openrouter.ai/api\nAuth:      Bearer token',
    );
  });

  it('renders the OAuth token label for oauth', () => {
    expect(formatPreviewHeader('https://custom.api/v1', 'oauth')).toContain(
      'Auth:      OAuth token',
    );
  });

  it('falls back to the raw value for an unknown auth type', () => {
    expect(formatPreviewHeader('https://example.test', 'custom-scheme')).toContain(
      'Auth:      custom-scheme',
    );
  });
});
