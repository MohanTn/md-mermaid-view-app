import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    environmentMatchGlobs: [
      ['**/tests/file-service.test.ts', 'node'],
      ['**/tests/code-graph.test.ts', 'node'],
      ['**/tests/lsp-manager.test.ts', 'node'],
      ['**/tests/parquet.test.ts', 'node'],
    ],
    include: ['tests/**/*.test.ts'],
  },
});
