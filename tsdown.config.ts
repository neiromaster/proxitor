import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/cli.ts', 'src/index.ts'],
  format: ['esm', 'cjs'],
  dts: { resolve: true },
  clean: true,
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  hash: false,
})
