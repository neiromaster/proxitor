import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { cli: 'src/bin/main.ts' },
  format: 'esm',
  outDir: 'dist',
  outExtensions: () => ({ js: '.mjs' }),
  dts: false,
  noExternal: ['@proxitor/plugin-api'],
});
