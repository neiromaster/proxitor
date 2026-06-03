import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/cli.ts', 'src/index.ts'],
  format: ['esm', 'cjs'],
  dts: { resolver: 'tsc' },
  clean: true,
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  hash: false,
})
