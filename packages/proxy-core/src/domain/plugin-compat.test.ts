import { describe, expect, it } from 'vitest';
import { RoutingConfigError } from './error.js';
import { assertPluginFormatCompatible } from './plugin-compat.js';

describe('assertPluginFormatCompatible', () => {
  it('passes when the declared format matches the outbound format', () => {
    // Arrange
    const plugin = { reservedKeys: { 'openai-chat': ['$proxitor.provider'] } };

    // Act + Assert
    expect(() =>
      assertPluginFormatCompatible(plugin, 'openai-chat', 'openrouter-routing'),
    ).not.toThrow();
  });

  it('throws RoutingConfigError naming plugin and formats on mismatch', () => {
    // Arrange
    const plugin = { reservedKeys: { 'openai-chat': ['$proxitor.provider'] } };

    // Act + Assert
    expect(() =>
      assertPluginFormatCompatible(plugin, 'anthropic-messages', 'openrouter-routing'),
    ).toThrow(RoutingConfigError);
    expect(() =>
      assertPluginFormatCompatible(plugin, 'anthropic-messages', 'openrouter-routing'),
    ).toThrow(/openrouter-routing.*openai-chat.*anthropic-messages/);
  });

  it('passes when the plugin declares no reservedKeys', () => {
    // Arrange
    const plugin = {};

    // Act + Assert
    expect(() =>
      assertPluginFormatCompatible(plugin, 'anthropic-messages', 'cache-control'),
    ).not.toThrow();
  });

  it('passes when the plugin declares both formats', () => {
    // Arrange
    const plugin = {
      reservedKeys: { 'openai-chat': [], 'anthropic-messages': [] },
    };

    // Act + Assert
    expect(() =>
      assertPluginFormatCompatible(plugin, 'anthropic-messages', 'dual'),
    ).not.toThrow();
    expect(() =>
      assertPluginFormatCompatible(plugin, 'openai-chat', 'dual'),
    ).not.toThrow();
  });
});
