import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^\.\.?\/main$/,
        replacement: fileURLToPath(new URL('./main.ts', import.meta.url))
      },
      {
        find: 'obsidian',
        replacement: fileURLToPath(new URL('./tests/obsidian.mock.ts', import.meta.url))
      },
      { find: 'commons/properties', replacement: resolve(import.meta.dirname, '../obsidian-commons/src/properties/index.ts') },
      { find: 'commons/workspace', replacement: resolve(import.meta.dirname, '../obsidian-commons/src/workspace/index.ts') },
      { find: 'commons/windows', replacement: resolve(import.meta.dirname, '../obsidian-commons/src/windows/index.ts') },
      { find: 'commons/modal', replacement: resolve(import.meta.dirname, '../obsidian-commons/src/modal/index.ts') },
      { find: 'commons/search', replacement: resolve(import.meta.dirname, '../obsidian-commons/src/search/index.ts') },
      { find: 'commons/geometry', replacement: resolve(import.meta.dirname, '../obsidian-commons/src/geometry/index.ts') },
      { find: 'commons/os', replacement: resolve(import.meta.dirname, '../obsidian-commons/src/os/index.ts') },
      { find: 'commons/testing', replacement: resolve(import.meta.dirname, '../obsidian-commons/src/testing/index.ts') },
      { find: 'commons/internals', replacement: resolve(import.meta.dirname, '../obsidian-commons/src/internals.ts') }
    ]
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['main.ts', 'link-decorator.ts', 'link-color-service.ts', 'color-optimizer.ts'],
      thresholds: {
        statements: 75,
        branches: 70,
        functions: 80,
        lines: 75
      }
    }
  }
});
