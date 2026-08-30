import type { ProxyPlugin } from '@proxitor/plugin-api';
import { describe, expect, it } from 'vitest';
import { RoutingConfigError } from '../domain/index.js';
import { createPluginManager, type PluginActivationSkip } from './plugin-manager.js';

type Warn = { message: string; context?: unknown };

const logger = {
  infos: [] as string[],
  warns: [] as Warn[],
  errors: [] as Warn[],
  debugs: [] as Warn[],
  info(message: string) {
    this.infos.push(message);
  },
  warn(message: string, context?: unknown) {
    this.warns.push({ message, context });
  },
  error(message: string, context?: unknown) {
    this.errors.push({ message, context });
  },
  debug(message: string, context?: unknown) {
    this.debugs.push({ message, context });
  },
};

function makePlugin(name: string, overrides: Partial<ProxyPlugin> = {}): ProxyPlugin {
  return { name, ...overrides };
}

describe('createPluginManager', () => {
  it('activates effective plugins in order with their configs', () => {
    // Arrange
    const first = makePlugin('first', {
      validateConfig: raw => ({ count: Number(raw) }),
    });
    const second = makePlugin('second');
    const manager = createPluginManager({
      plugins: new Map([
        ['first', first],
        ['second', second],
      ]),
      logger,
    });
    // Act
    const active = manager.activate(
      [{ name: 'first', config: 3 }, { name: 'second' }],
      'anthropic-messages',
    );
    // Assert
    expect(active).toEqual([
      { name: 'first', plugin: first, config: { count: 3 } },
      { name: 'second', plugin: second, config: undefined },
    ]);
  });

  it('throws RoutingConfigError for an unknown plugin name, listing the registry', () => {
    // Arrange
    const manager = createPluginManager({
      plugins: new Map([['known', makePlugin('known')]]),
      logger,
    });
    // Act / Assert
    expect(() => manager.activate([{ name: 'ghost' }], 'anthropic-messages')).toThrow(
      RoutingConfigError,
    );
    expect(() => manager.activate([{ name: 'ghost' }], 'anthropic-messages')).toThrow(
      /ghost/,
    );
  });

  it('wraps a validateConfig rejection in RoutingConfigError', () => {
    // Arrange
    const strict = makePlugin('strict', {
      validateConfig: raw => {
        if (raw !== 42) {
          throw new Error('config must be 42');
        }
        return raw;
      },
    });
    const manager = createPluginManager({
      plugins: new Map([['strict', strict]]),
      logger,
    });
    // Act / Assert
    expect(() =>
      manager.activate([{ name: 'strict', config: 41 }], 'anthropic-messages'),
    ).toThrow(RoutingConfigError);
    expect(() =>
      manager.activate([{ name: 'strict', config: 41 }], 'anthropic-messages'),
    ).toThrow(/strict.*config must be 42/);
  });

  it('passes config through untouched when the plugin has no validateConfig', () => {
    // Arrange
    const plain = makePlugin('plain');
    const manager = createPluginManager({ plugins: new Map([['plain', plain]]), logger });
    // Act
    const active = manager.activate(
      [{ name: 'plain', config: { any: 'shape' } }],
      'anthropic-messages',
    );
    // Assert
    expect(active[0]?.config).toEqual({ any: 'shape' });
  });

  it('snapshots exportState from stateful plugins and skips the rest', () => {
    // Arrange
    let counter = 7;
    const stateful = makePlugin('stateful', {
      exportState: () => ({ counter }),
      restoreState: state => {
        counter = (state as { counter: number }).counter;
      },
    });
    const stateless = makePlugin('stateless');
    const manager = createPluginManager({
      plugins: new Map([
        ['stateful', stateful],
        ['stateless', stateless],
      ]),
      logger,
    });
    // Act
    const snapshot = manager.snapshot();
    // Assert
    expect(snapshot).toEqual({ stateful: { counter: 7 } });
  });

  it('restores state by plugin name and ignores unknown names', () => {
    // Arrange
    let counter = 7;
    const stateful = makePlugin('stateful', {
      exportState: () => ({ counter }),
      restoreState: state => {
        counter = (state as { counter: number }).counter;
      },
    });
    const manager = createPluginManager({
      plugins: new Map([['stateful', stateful]]),
      logger,
    });
    // Act
    manager.restore({ stateful: { counter: 99 }, ghost: { whatever: 1 } });
    // Assert
    expect(counter).toBe(99);
    expect(logger.warns).toEqual([]);
  });

  it('logs a warning instead of throwing when exportState or restoreState fails', () => {
    // Arrange
    const broken = makePlugin('broken', {
      exportState: () => {
        throw new Error('export boom');
      },
      restoreState: () => {
        throw new Error('restore boom');
      },
    });
    const manager = createPluginManager({
      plugins: new Map([['broken', broken]]),
      logger,
    });
    // Act
    const snapshot = manager.snapshot();
    manager.restore({ broken: {} });
    // Assert
    expect(snapshot).toEqual({});
    expect(logger.warns.map(w => w.message)).toEqual([
      'plugin state export failed',
      'plugin state restore failed',
    ]);
  });

  it('skips a plugin whose reservedKeys target another wire format and reports the skip', () => {
    // Arrange
    const skips: PluginActivationSkip[] = [];
    const manager = createPluginManager({
      plugins: new Map([
        [
          'or-route',
          { name: 'or-route', reservedKeys: { 'openai-chat': ['$proxitor.provider'] } },
        ],
      ]),
      logger,
    });

    // Act
    const active = manager.activate([{ name: 'or-route' }], 'anthropic-messages', skip =>
      skips.push(skip),
    );

    // Assert
    expect(active).toEqual([]);
    expect(skips).toEqual([{ plugin: 'or-route', wireFormat: 'anthropic-messages' }]);
  });

  it('skips only the incompatible entries; compatible ones still activate in order', () => {
    // Arrange
    const orRoute: ProxyPlugin = {
      name: 'or-route',
      reservedKeys: { 'openai-chat': ['$proxitor.provider'] },
    };
    const plain = makePlugin('plain');
    const manager = createPluginManager({
      plugins: new Map([
        ['or-route', orRoute],
        ['plain', plain],
      ]),
      logger,
    });
    const skips: PluginActivationSkip[] = [];

    // Act
    const active = manager.activate(
      [{ name: 'or-route' }, { name: 'plain' }],
      'anthropic-messages',
      skip => skips.push(skip),
    );

    // Assert
    expect(active).toEqual([{ name: 'plain', plugin: plain, config: undefined }]);
    expect(skips).toEqual([{ plugin: 'or-route', wireFormat: 'anthropic-messages' }]);
  });

  it('accepts a plugin whose reservedKeys match the outbound wire format', () => {
    // Arrange
    const manager = createPluginManager({
      plugins: new Map([
        [
          'or-route',
          { name: 'or-route', reservedKeys: { 'openai-chat': ['$proxitor.provider'] } },
        ],
      ]),
      logger,
    });

    // Act
    const active = manager.activate([{ name: 'or-route' }], 'openai-chat');

    // Assert
    expect(active).toHaveLength(1);
    expect(active[0]?.name).toBe('or-route');
  });
});
