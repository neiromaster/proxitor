import { describe, expect, it } from 'vitest';
import { normalizeVolatileSystemBlocks } from './normalize-volatile-system.js';

describe('normalizeVolatileSystemBlocks', () => {
  it('normalizes the cch hash in a string system', () => {
    // Arrange
    const system = 'x-anthropic-billing-header: cc_version=2.1; cch=4bec5;';

    // Act
    const { changed, value } = normalizeVolatileSystemBlocks(system);

    // Assert
    expect(changed).toBe(true);
    expect(value).toBe('x-anthropic-billing-header: cc_version=2.1; cch=00000;');
  });

  it('leaves a string system unchanged when no cch is present', () => {
    // Arrange
    const system = 'You are a helpful assistant.';

    // Act
    const { changed, value } = normalizeVolatileSystemBlocks(system);

    // Assert
    expect(changed).toBe(false);
    expect(value).toBe(system);
  });

  it('normalizes cch inside a text block of a system array', () => {
    // Arrange
    const system = [
      { type: 'text', text: 'x-anthropic-billing-header: cch=4bec5;' },
      { type: 'text', text: 'You are Claude Code.' },
    ];

    // Act
    const { changed, value } = normalizeVolatileSystemBlocks(system);

    // Assert
    expect(changed).toBe(true);
    expect(value).toEqual([
      { type: 'text', text: 'x-anthropic-billing-header: cch=00000;' },
      { type: 'text', text: 'You are Claude Code.' },
    ]);
  });

  it('leaves a system array unchanged when no block contains cch', () => {
    // Arrange
    const system = [{ type: 'text', text: 'stable instructions' }];

    // Act
    const { changed, value } = normalizeVolatileSystemBlocks(system);

    // Assert
    expect(changed).toBe(false);
    expect(value).toBe(system);
  });

  it('normalizes multiple cch occurrences in one string', () => {
    // Arrange
    const system = 'a cch=1 b cch=2face c';

    // Act
    const { changed, value } = normalizeVolatileSystemBlocks(system);

    // Assert
    expect(changed).toBe(true);
    expect(value).toBe('a cch=00000 b cch=00000 c');
  });

  it('normalizes the cc_version trailing hash (preserving the semver) in a string system', () => {
    // Arrange — the billing header drifts both the cc_version trailing hash
    // and the cch hash every turn; both must collapse to a constant prefix.
    const system =
      'x-anthropic-billing-header: cc_version=2.1.177.06f; cc_entrypoint=cli; cch=4bec5;';

    // Act
    const { changed, value } = normalizeVolatileSystemBlocks(system);

    // Assert
    expect(changed).toBe(true);
    expect(value).toBe(
      'x-anthropic-billing-header: cc_version=2.1.177.0; cc_entrypoint=cli; cch=00000;',
    );
  });

  it('normalizes the cc_version trailing hash inside a text block of a system array', () => {
    // Arrange
    const system = [
      { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.177.c7c;' },
      { type: 'text', text: 'You are Claude Code.' },
    ];

    // Act
    const { changed, value } = normalizeVolatileSystemBlocks(system);

    // Assert
    expect(changed).toBe(true);
    expect(value).toEqual([
      { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.177.0;' },
      { type: 'text', text: 'You are Claude Code.' },
    ]);
  });

  it('passes through undefined / non-string-non-array system unchanged', () => {
    // Arrange & Act & Assert
    expect(normalizeVolatileSystemBlocks(undefined)).toEqual({
      changed: false,
      value: undefined,
    });
    expect(normalizeVolatileSystemBlocks(null)).toEqual({
      changed: false,
      value: null,
    });
  });

  it('skips blocks whose text is not a string', () => {
    // Arrange
    const system = [{ type: 'image', source: { data: 'x' } }];

    // Act
    const { changed, value } = normalizeVolatileSystemBlocks(system);

    // Assert
    expect(changed).toBe(false);
    expect(value).toBe(system);
  });
});
