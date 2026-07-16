import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^\.\/main$/,
        replacement: fileURLToPath(new URL('./main.ts', import.meta.url))
      },
      {
        find: 'obsidian',
        replacement: fileURLToPath(new URL('./tests/obsidian.mock.ts', import.meta.url))
      }
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
