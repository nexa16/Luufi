import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    include: [
      'lib/domain/**/*.test.ts',
      'lib/services/deployment-identity.test.ts',
      '.github/scripts/**/*.test.ts',
    ],
    allowOnly: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      reportsDirectory: 'coverage/unit',
      include: [
        'lib/domain/**/*.ts',
        'lib/services/deployment-identity.ts',
        '.github/scripts/*.cjs',
      ],
      exclude: ['**/*.test.*'],
      thresholds: {
        statements: 80,
        branches: 60,
        functions: 70,
        lines: 80,
        perFile: false,
      },
    },
  },
});
