import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: {
    '@meltek/schema': fileURLToPath(new URL('../schema/src/index.ts', import.meta.url)),
    '@meltek/engine': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
  } },
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/reference/**', 'src/index.ts'],
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
    },
  },
});
