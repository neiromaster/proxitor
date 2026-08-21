import { binary, dryRun } from 'cmd-ts';
import { rootCli } from './root-cli.js';
import { version } from './version.js';

describe('root cli', () => {
  it('exposes the package version', () => {
    expect(version).toBe('0.0.0');
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
});
