import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    typecheck: {
      include: ['src/**/*.test-d.ts'],
    },
  },
  resolveJsonModule: true,
});
