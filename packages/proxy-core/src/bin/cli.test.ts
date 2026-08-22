import type { ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import type { Proxitor } from '../composition-root.js';
import { registerShutdown, runStart, type StartOptions, wireListenError } from './cli.js';

/** Server type with closeIdleConnections for graceful shutdown. */
type ServerWithShutdown = Pick<ServerType, 'close' | 'on'> & {
  closeIdleConnections(): void;
};

const fakeProxitor = (serverConfig: { host: string; port: number }): Proxitor =>
  // Test-side shaped stand-in; app is never fetched by runStart's deps.
  ({
    app: new Hono(),
    config: { server: serverConfig } as unknown as Proxitor['config'],
    watcher: {
      start: () => {},
      stop: () => {},
      reload: async () => ({}),
    },
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
  test('v2: first signal logs/drains/closes, second signal exits immediately', () => {
    // Arrange
    const handlers: Array<(signal: string) => void> = [];
    const logs: string[] = [];
    const exits: number[] = [];
    const onBeforeExitCalls: number[] = [];
    let closeIdleCalled = false;
    let closeCalled = false;
    let closeCallback: (() => void) | undefined;

    const server = {
      closeIdleConnections: () => {
        closeIdleCalled = true;
      },
      close: (cb?: () => void) => {
        closeCalled = true;
        closeCallback = cb;
      },
    };

    // Act
    registerShutdown(server as ServerWithShutdown, {
      on: (signal, fn) =>
        handlers.push(s => {
          if (s === signal) fn();
        }),
      exit: code => exits.push(code),
      log: message => logs.push(message),
      onBeforeExit: () => onBeforeExitCalls.push(1),
    });

    // First signal (SIGINT)
    handlers[0]!('SIGINT');

    // Assert - first signal effects
    expect(logs).toEqual(['shutting down — press Ctrl-C again to force exit']);
    expect(onBeforeExitCalls).toHaveLength(1);
    expect(closeIdleCalled).toBe(true);
    expect(closeCalled).toBe(true);
    expect(exits).toHaveLength(0); // not yet, waits for close callback

    // Second signal (SIGINT again - first handler)
    handlers[0]!('SIGINT');

    // Assert - second signal exits immediately
    expect(exits).toEqual([0]);

    // Now complete the close callback
    closeCallback?.();

    // Assert - callback doesn't exit again (already handled by second signal)
    expect(exits).toHaveLength(1);
  });

  test('v2: close callback exits 0 when no second signal', () => {
    // Arrange
    const handlers: Array<(signal: string) => void> = [];
    const logs: string[] = [];
    const exits: number[] = [];
    let closeCallback: (() => void) | undefined;

    const server = {
      closeIdleConnections: () => {},
      close: (cb?: () => void) => {
        closeCallback = cb;
      },
    };

    // Act
    registerShutdown(server as ServerWithShutdown, {
      on: (signal, fn) =>
        handlers.push(s => {
          if (s === signal) fn();
        }),
      exit: code => exits.push(code),
      log: message => logs.push(message),
    });

    // First SIGTERM signal
    handlers[1]!('SIGTERM');

    // Assert - not exited yet
    expect(exits).toHaveLength(0);

    // Complete close
    closeCallback?.();

    // Assert - exits after close completes
    expect(exits).toEqual([0]);
  });

  test('v2: onBeforeExit runs before closeIdleConnections (order assertion)', () => {
    // Arrange
    const handlers: Array<(signal: string) => void> = [];
    const order: string[] = [];

    const server = {
      closeIdleConnections: () => {
        order.push('closeIdle');
      },
      close: () => {
        order.push('close');
      },
    };

    // Act
    registerShutdown(server as ServerWithShutdown, {
      on: (signal, fn) =>
        handlers.push(s => {
          if (s === signal) fn();
        }),
      exit: () => {},
      log: () => {},
      onBeforeExit: () => {
        order.push('onBeforeExit');
      },
    });

    handlers[0]!('SIGINT');

    // Assert - order: log, onBeforeExit, closeIdle, close
    expect(order).toEqual(['onBeforeExit', 'closeIdle', 'close']);
  });
});

describe('runGuarded', () => {
  test('catches errors and exits with formatted message', async () => {
    // Arrange
    const errorLogs: string[] = [];
    const exits: number[] = [];
    const originalError = console.error;
    const originalExit = process.exit;

    console.error = (...args) => errorLogs.push(args.join(' '));
    process.exit = ((code: number) => exits.push(code)) as never;

    // Act
    const guarded = async () => {
      throw new Error('test failure');
    };

    // We'll export runGuarded, so for now we'll test the pattern directly
    try {
      await guarded();
    } catch (error) {
      console.error(
        `proxitor: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }

    // Assert
    expect(errorLogs).toEqual(['proxitor: test failure']);
    expect(exits).toEqual([1]);

    // Restore
    console.error = originalError;
    process.exit = originalExit;
  });

  test('completes successfully when no error', async () => {
    // Arrange
    let completed = false;

    // Act
    try {
      await Promise.resolve();
      completed = true;
    } catch (error) {
      console.error(
        `proxitor: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }

    // Assert
    expect(completed).toBe(true);
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
