import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'tsdown'

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'))

export default defineConfig({
  entry: ['src/cli.ts', 'src/index.ts'],
  format: ['esm', 'cjs'],
  dts: { resolver: 'tsc' },
  clean: true,
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  hash: false,
  define: {
    __PROXITOR_VERSION__: JSON.stringify(pkg.version),
  },
  deps: {
    alwaysBundle: Object.keys(pkg.dependencies ?? {}),
  },
})
