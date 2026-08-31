import { binary, dryRun } from 'cmd-ts';
import pkg from '../../package.json' with { type: 'json' };
import { rootCli } from './root-cli.js';
import { version } from './version.js';

describe('root cli', () => {
  it('exposes the package version', () => {
    expect(version).toBe(pkg.version);
  });

  it('offers start as a subcommand', async () => {
    const result = await dryRun(binary(rootCli), ['node', 'proxitor']);
    if (result._tag === 'error') {
      expect(result.error).toContain('start');
    } else {
      throw new Error('Expected print-help error');
    }
  });

  it('offers config wizard as a subcommand', async () => {
    const result = await dryRun(binary(rootCli), ['node', 'proxitor', 'config']);
    if (result._tag === 'error') {
      expect(result.error).toContain('wizard');
    } else {
      throw new Error('Expected print-help error');
    }
  });

  it('offers doctor as a subcommand', async () => {
    const result = await dryRun(binary(rootCli), [
      'node',
      'proxitor',
      'doctor',
      '--help',
    ]);
    if (result._tag === 'error') {
      expect(result.error).toContain('doctor');
    } else {
      throw new Error('Expected print-help error');
    }
  });
});
