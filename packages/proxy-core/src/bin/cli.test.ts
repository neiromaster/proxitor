import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import type { Proxitor } from '../composition-root.js';
import { registerShutdown, runStart, type StartOptions, wireListenError } from './cli.js';

const fakeProxitor = (serverConfig: { host: string; port: number }): Proxitor =>
  // Test-side shaped stand-in; app is never fetched by runStart's deps.
  ({
    app: new Hono(),
    config: { server: serverConfig } as unknown as Proxitor['config'],
  }) as unknown as Proxitor;

describe('runStart', () => {
  test('flags override config host/port; serve receives the hono fetch handler', async () => {
    // Arrange
    const served: unknown[] = [];
    const opts: StartOptions = { host: '0.0.0.0', port: 9999, verbose: false };
    // Act
    await runStart(opts, {
      createApp: async () => fakeProxitor({ host: '127.0.0.1', port: 8828 }),
      serveImpl: ((serveOptions: unknown) => {
        served.push(serveOptions);
        return {
          close: (cb?: () => void) => {
            cb?.();
          },
          on: () => undefined,
        } as unknown;
      }) as unknown as NonNullable<Parameters<typeof runStart>[1]>['serveImpl'],
      registerSignal: () => {},
    });
    // Assert
    expect(served[0]).toMatchObject({ hostname: '0.0.0.0', port: 9999 });
  });

  test('config values are used when flags are absent', async () => {
    const served: unknown[] = [];
    await runStart(
      { verbose: false },
      {
        createApp: async () => fakeProxitor({ host: '127.0.0.1', port: 8828 }),
        serveImpl: ((o: unknown) => {
          served.push(o);
          return {
            close: (cb?: () => void) => {
              cb?.();
            },
            on: () => undefined,
          } as unknown;
        }) as never,
        registerSignal: () => {},
      },
    );
    expect(served[0]).toMatchObject({ hostname: '127.0.0.1', port: 8828 });
  });
});

describe('registerShutdown', () => {
  test('SIGINT and SIGTERM close the server then exit(0)', () => {
    // Arrange
    const handlers = new Map<string, () => void>();
    const closed: number[] = [];
    const exits: number[] = [];
    const server = {
      close: (cb?: () => void) => {
        closed.push(1);
        cb?.();
      },
    };
    // Act
    registerShutdown(server as Pick<never, 'close'>, {
      on: (signal, fn) => handlers.set(signal, fn),
      exit: code => exits.push(code),
    });
    handlers.get('SIGINT')?.();
    handlers.get('SIGTERM')?.();
    // Assert
    expect(closed).toHaveLength(2);
    expect(exits).toEqual([0, 0]);
  });
});

describe('wireListenError', () => {
  test('fails with a one-line message carrying host:port and the OS error', () => {
    // Arrange
    const listeners: Record<string, (error: Error) => void> = {};
    const server = {
      on: (event: 'error', handler: (error: Error) => void) => {
        listeners[event] = handler;
        return undefined;
      },
    };
    const failures: string[] = [];
    // Act
    wireListenError(server, '127.0.0.1', 8828, {
      fail: message => failures.push(message),
    });
    listeners.error!(new Error('listen EADDRINUSE: address already in use'));
    // Assert
    expect(failures).toEqual([
      'cannot listen on 127.0.0.1:8828 — listen EADDRINUSE: address already in use',
    ]);
  });

  test('runStart wires the listen-error handler onto the served server', async () => {
    // Arrange
    const registered: string[] = [];
    const fakeServer = {
      on: (event: string) => {
        registered.push(event);
        return undefined;
      },
      close: (cb?: () => void) => {
        cb?.();
        return fakeServer;
      },
    };
    // Act
    await runStart(
      { verbose: false },
      {
        createApp: async () => fakeProxitor({ host: '127.0.0.1', port: 8828 }),
        serveImpl: (() => fakeServer) as unknown as NonNullable<
          Parameters<typeof runStart>[1]
        >['serveImpl'],
        registerSignal: () => {},
      },
    );
    // Assert
    expect(registered).toContain('error');
  });
});
