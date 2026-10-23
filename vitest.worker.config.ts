import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
const migrations = await readD1Migrations(
  fileURLToPath(new URL('./drizzle', import.meta.url)),
);
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: '2026-09-10',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: ['DB', 'LEGACY_DB'],
        bindings: {
          LUUFI_ENVIRONMENT: 'preview',
          LUUFI_SOURCE_BRANCH: 'develop',
          LUUFI_COMMIT_SHA: '1234567890abcdef1234567890abcdef12345678',
          TEST_MIGRATIONS: migrations,
        },
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      'next/server': fileURLToPath(
        new URL('./tests/support/next-server.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['tests/worker/**/*.test.ts'],
    setupFiles: ['tests/worker/setup.ts'],
    allowOnly: false,
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json-summary', 'json'],
      reportsDirectory: 'coverage/worker',
      include: [
        'app/api/**/*.ts',
        'app/mcp/**/*.ts',
        'lib/auth/**/*.ts',
        'lib/data/**/*.ts',
        'lib/http/**/*.ts',
        'lib/mcp/**/*.ts',
        'lib/services/**/*.ts',
      ],
      exclude: ['**/*.test.*', 'lib/services/deployment-identity.ts'],
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
