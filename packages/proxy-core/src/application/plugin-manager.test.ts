import type { ProxyPlugin } from '@proxitor/plugin-api';
import { describe, expect, it } from 'vitest';
import { RoutingConfigError } from '../domain/index.js';
import { createPluginManager } from './plugin-manager.js';

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
    const active = manager.activate([{ name: 'first', config: 3 }, { name: 'second' }]);
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
    expect(() => manager.activate([{ name: 'ghost' }])).toThrow(RoutingConfigError);
    expect(() => manager.activate([{ name: 'ghost' }])).toThrow(/ghost/);
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
    expect(() => manager.activate([{ name: 'strict', config: 41 }])).toThrow(
      RoutingConfigError,
    );
    expect(() => manager.activate([{ name: 'strict', config: 41 }])).toThrow(
      /strict.*config must be 42/,
    );
  });

  it('passes config through untouched when the plugin has no validateConfig', () => {
    // Arrange
    const plain = makePlugin('plain');
    const manager = createPluginManager({ plugins: new Map([['plain', plain]]), logger });
    // Act
    const active = manager.activate([{ name: 'plain', config: { any: 'shape' } }]);
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
});
