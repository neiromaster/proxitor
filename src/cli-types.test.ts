import { command, dryRun, option, positional, runSafely } from 'cmd-ts';
import { describe, expect, it } from 'vitest';
import { AuthTypeCli, ConfigPath, NonEmptyString, Port } from './cli-types.js';

describe('ConfigPath', () => {
  const cmd = command({
    name: 't',
    args: { p: positional({ type: ConfigPath, displayName: 'p' }) },
    handler: args => args,
  });

  it('resolves to the positional value when supplied', async () => {
    const result = await runSafely(cmd, ['/etc/proxitor.yaml']);
    expect(result._tag).toBe('ok');
    if (result._tag === 'ok') {
      expect(result.value).toEqual({ p: '/etc/proxitor.yaml' });
    }
  });

  it('resolves to undefined when omitted', async () => {
    const result = await runSafely(cmd, []);
    expect(result._tag).toBe('ok');
    if (result._tag === 'ok') {
      expect(result.value).toEqual({ p: undefined });
    }
  });
});

describe('Port', () => {
  const cmd = command({
    name: 't',
    args: { port: option({ long: 'port', type: Port }) },
    handler: args => args,
  });

  it('accepts a valid port', async () => {
    const result = await runSafely(cmd, ['--port', '9000']);
    expect(result._tag).toBe('ok');
    if (result._tag === 'ok') expect(result.value).toEqual({ port: 9000 });
  });

  it('rejects port 0', async () => {
    const dry = await dryRun(cmd, ['--port', '0']);
    expect(dry._tag).toBe('error');
    if (dry._tag === 'error') expect(dry.error).toContain('1-65535');
  });

  it('rejects port > 65535', async () => {
    const dry = await dryRun(cmd, ['--port', '70000']);
    expect(dry._tag).toBe('error');
    if (dry._tag === 'error') expect(dry.error).toContain('1-65535');
  });

  it('rejects non-integer port', async () => {
    const dry = await dryRun(cmd, ['--port', '3.5']);
    expect(dry._tag).toBe('error');
    if (dry._tag === 'error') expect(dry.error).toContain('1-65535');
  });
});

describe('NonEmptyString', () => {
  const cmd = command({
    name: 't',
    args: { v: option({ long: 'v', type: NonEmptyString }) },
    handler: args => args,
  });

  it('accepts a non-empty value', async () => {
    const result = await runSafely(cmd, ['--v', 'hello']);
    expect(result._tag).toBe('ok');
    if (result._tag === 'ok') expect(result.value).toEqual({ v: 'hello' });
  });

  it('rejects whitespace-only string', async () => {
    const dry = await dryRun(cmd, ['--v', '   ']);
    expect(dry._tag).toBe('error');
    if (dry._tag === 'error') expect(dry.error).toContain('must not be empty');
  });
});

describe('AuthTypeCli', () => {
  const cmd = command({
    name: 't',
    args: { a: option({ long: 'auth', type: AuthTypeCli }) },
    handler: args => args,
  });

  it('accepts bearer', async () => {
    const result = await runSafely(cmd, ['--auth', 'bearer']);
    expect(result._tag).toBe('ok');
    if (result._tag === 'ok') expect(result.value).toEqual({ a: 'bearer' });
  });

  it('accepts oauth', async () => {
    const result = await runSafely(cmd, ['--auth', 'oauth']);
    expect(result._tag).toBe('ok');
    if (result._tag === 'ok') expect(result.value).toEqual({ a: 'oauth' });
  });

  it('rejects unknown auth type', async () => {
    const dry = await dryRun(cmd, ['--auth', 'magic']);
    expect(dry._tag).toBe('error');
    if (dry._tag === 'error') expect(dry.error).toContain('bearer');
  });
});
