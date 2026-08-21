import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/bin/main.ts'],
  format: 'esm',
  outDir: 'dist',
  outExtensions: () => ({ js: '.mjs' }),
});
