import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { definePlugin } from './define-plugin.js';

describe('definePlugin', () => {
  it('wires a zod schema into validateConfig', () => {
    // Arrange
    const schema = z.object({ ttl: z.enum(['5m', '1h']) });
    // Act
    const plugin = definePlugin(schema, { name: 'cache-control' });
    const parsed = plugin.validateConfig?.({ ttl: '1h' });
    // Assert
    expect(parsed).toEqual({ ttl: '1h' });
  });

  it('throws ZodError on invalid config', () => {
    // Arrange
    const plugin = definePlugin(z.object({ ttl: z.string() }), { name: 'x' });
    // Act + Assert
    expect(() => plugin.validateConfig?.({ ttl: 42 })).toThrow(z.ZodError);
  });

  it('passes a plugin through untouched when no schema is given', () => {
    // Arrange
    const plain = { name: 'noop' };
    // Act
    const result = definePlugin(plain);
    // Assert
    expect(result).toBe(plain);
  });

  it('preserves the plugin fields alongside validateConfig', () => {
    // Arrange
    const plugin = definePlugin(z.number(), { name: 'limiter' });
    // Act
    const config = plugin.validateConfig?.(5);
    // Assert
    expect(config).toBe(5);
    expect(plugin.name).toBe('limiter');
  });
});
