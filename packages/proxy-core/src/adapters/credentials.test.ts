import { describe, expect, test } from 'vitest';
import { createCredentialAdapter } from './credentials.js';

const FS = (mode: number, content = 'sk-secret\n') => ({
  stat: async () => ({ mode }),
  readFile: async () => content,
});

describe('createCredentialAdapter', () => {
  test('literal string credentials pass through', () => {
    const adapter = createCredentialAdapter({ env: {} });
    expect(adapter.resolve('sk-literal')).toBe('sk-literal');
  });

  test('{env}: resolves from env; missing or empty throws naming the var', () => {
    const adapter = createCredentialAdapter({ env: { KEY: 'v' } });
    expect(adapter.resolve({ env: 'KEY' })).toBe('v');
    expect(() => adapter.resolve({ env: 'MISSING' })).toThrow(/MISSING/);
    expect(() =>
      createCredentialAdapter({ env: { EMPTY: '' } }).resolve({ env: 'EMPTY' }),
    ).toThrow(/EMPTY/);
  });

  test('{file}: preload checks mode 600 and caches trimmed content; resolve before preload throws', async () => {
    const adapter = createCredentialAdapter(FS(0o600));
    expect(() => adapter.resolve({ file: '/k.pem' })).toThrow(/preload/);
    await adapter.preload([{ file: '/k.pem' }]);
    expect(adapter.resolve({ file: '/k.pem' })).toBe('sk-secret');
  });

  test('{file}: wrong mode (644) or empty file fails preload with the mode/content in the message', async () => {
    await expect(
      createCredentialAdapter(FS(0o644)).preload([{ file: '/k.pem' }]),
    ).rejects.toThrow(/600/);
    await expect(
      createCredentialAdapter(FS(0o600, '  \n')).preload([{ file: '/k.pem' }]),
    ).rejects.toThrow(/empty/);
  });

  test('preload skips literals and env refs; file refs are re-read on every preload', async () => {
    let reads = 0;
    const adapter = createCredentialAdapter({
      env: { E: 'e' },
      stat: async () => ({ mode: 0o600 }),
      readFile: async () => {
        reads += 1;
        return 'x';
      },
    });
    await adapter.preload(['lit', { env: 'E' }]);
    expect(reads).toBe(0);
    await adapter.preload([{ file: '/k' }]);
    await adapter.preload([{ file: '/k' }]);
    expect(reads).toBe(2);
  });

  test('{file}: preload re-reads rotated content — resolve returns the new secret', async () => {
    // Arrange
    let content = 'sk-old\n';
    const adapter = createCredentialAdapter({
      stat: async () => ({ mode: 0o600 }),
      readFile: async () => content,
    });
    await adapter.preload([{ file: '/k.pem' }]);
    expect(adapter.resolve({ file: '/k.pem' })).toBe('sk-old');

    // Act — rotate the key on disk and preload again
    content = 'sk-new\n';
    await adapter.preload([{ file: '/k.pem' }]);

    // Assert
    expect(adapter.resolve({ file: '/k.pem' })).toBe('sk-new');
  });

  test('{file}: failed preload keeps the previous cache usable (keep-last-valid)', async () => {
    // Arrange
    let mode = 0o600;
    const adapter = createCredentialAdapter({
      stat: async () => ({ mode }),
      readFile: async path => (path === '/k.pem' ? 'sk-old' : 'other'),
    });
    await adapter.preload([{ file: '/k.pem' }]);

    // Act — break the file (bad mode) and preload again
    mode = 0o644;
    await expect(adapter.preload([{ file: '/k.pem' }])).rejects.toThrow(/600/);

    // Assert — old content still resolves for the still-active config
    expect(adapter.resolve({ file: '/k.pem' })).toBe('sk-old');
  });

  test('{file}: refs removed from the config are dropped from the cache on next preload', async () => {
    // Arrange
    const adapter = createCredentialAdapter({
      stat: async () => ({ mode: 0o600 }),
      readFile: async path => `secret-for-${path}`,
    });
    await adapter.preload([{ file: '/a.pem' }, { file: '/b.pem' }]);

    // Act — reload with only /a.pem referenced
    await adapter.preload([{ file: '/a.pem' }]);

    // Assert — stale /b.pem is no longer served from cache
    expect(adapter.resolve({ file: '/a.pem' })).toBe('secret-for-/a.pem');
    expect(() => adapter.resolve({ file: '/b.pem' })).toThrow(/preload/);
  });
});
