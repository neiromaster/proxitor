import { describe, expect, test } from 'vitest';
import { RoutingConfigError } from './error.js';
import { mergePluginLayers, type PluginListEntry } from './plugin-merge.js';

describe('mergePluginLayers', () => {
  test('empty and undefined layers produce an empty list', () => {
    // Arrange
    const layers: ReadonlyArray<readonly PluginListEntry[] | undefined> = [undefined, []];

    // Act
    const effective = mergePluginLayers(...layers);

    // Assert
    expect(effective).toEqual([]);
  });

  test('preserves declaration order across layers (general → specific)', () => {
    // Arrange
    const globalPlugins = ['normalize-volatile-system', 'session-id'];
    const providerPlugins = ['cache-control'];

    // Act
    const effective = mergePluginLayers(globalPlugins, providerPlugins);

    // Assert
    expect(effective).toEqual([
      { name: 'normalize-volatile-system' },
      { name: 'session-id' },
      { name: 'cache-control' },
    ]);
  });

  test('object form carries config', () => {
    // Arrange
    const layer: readonly PluginListEntry[] = [
      'cache-control',
      { 'session-id': { mode: 'auto' } },
    ];

    // Act
    const effective = mergePluginLayers(layer);

    // Assert
    expect(effective).toEqual([
      { name: 'cache-control' },
      { name: 'session-id', config: { mode: 'auto' } },
    ]);
  });

  test('more specific layer overrides config, position unchanged', () => {
    // Arrange
    const globalPlugins: readonly PluginListEntry[] = [
      'normalize-volatile-system',
      { 'cache-control': { cacheControl: 'auto', rewriteBlockTtl: 'auto' } },
    ];
    const providerPlugins: readonly PluginListEntry[] = [
      { 'cache-control': { cacheControl: 'auto' } },
    ];

    // Act
    const effective = mergePluginLayers(globalPlugins, providerPlugins);

    // Assert
    expect(effective).toEqual([
      { name: 'normalize-volatile-system' },
      { name: 'cache-control', config: { cacheControl: 'auto' } },
    ]);
  });

  test('bare string re-declaration is a no-op (keeps position and config)', () => {
    // Arrange
    const globalPlugins: readonly PluginListEntry[] = [
      { 'cache-control': { cacheControl: 'auto' } },
    ];
    const providerPlugins: readonly PluginListEntry[] = ['cache-control'];

    // Act
    const effective = mergePluginLayers(globalPlugins, providerPlugins);

    // Assert
    expect(effective).toEqual([
      { name: 'cache-control', config: { cacheControl: 'auto' } },
    ]);
  });

  test('disable removes the plugin at its layer', () => {
    // Arrange
    const globalPlugins: readonly PluginListEntry[] = ['cache-control'];
    const bindingPlugins: readonly PluginListEntry[] = [{ 'cache-control': false }];

    // Act
    const effective = mergePluginLayers(globalPlugins, bindingPlugins);

    // Assert
    expect(effective).toEqual([]);
  });

  test('disable is not final — re-enable appends at the end with new config', () => {
    // Arrange
    const globalPlugins: readonly PluginListEntry[] = ['cache-control', 'session-id'];
    const providerPlugins: readonly PluginListEntry[] = [{ 'cache-control': false }];
    const bindingPlugins: readonly PluginListEntry[] = [
      { 'cache-control': { cacheControl: 'none' } },
    ];

    // Act
    const effective = mergePluginLayers(globalPlugins, providerPlugins, bindingPlugins);

    // Assert
    expect(effective).toEqual([
      { name: 'session-id' },
      { name: 'cache-control', config: { cacheControl: 'none' } },
    ]);
  });

  test('disabling an absent plugin is a no-op', () => {
    // Arrange
    const layer: readonly PluginListEntry[] = [{ 'cache-control': false }];

    // Act
    const effective = mergePluginLayers(layer);

    // Assert
    expect(effective).toEqual([]);
  });

  test('object entry with zero or multiple keys throws RoutingConfigError', () => {
    // Arrange
    const empty: readonly PluginListEntry[] = [{}];
    const twoKeys: readonly PluginListEntry[] = [
      { 'cache-control': {}, 'session-id': {} },
    ];

    // Act / Assert
    expect(() => mergePluginLayers(empty)).toThrow(RoutingConfigError);
    expect(() => mergePluginLayers(twoKeys)).toThrow(RoutingConfigError);
  });
});
