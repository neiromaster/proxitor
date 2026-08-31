import pkg from '../../package.json' with { type: 'json' };

/** Single source of the CLI version; the §13 build inlines it into dist/cli.mjs. */
export const version: string = pkg.version;
