import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      'cloudflare:workers': fileURLToPath(
        new URL('./tests/support/cloudflare-workers.ts', import.meta.url),
      ),
      'next/link': 'vinext/shims/link',
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/ui/**/*.test.tsx'],
    setupFiles: ['tests/ui/setup.ts'],
    allowOnly: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      reportsDirectory: 'coverage/ui',
      include: ['app/**/*.tsx', 'components/**/*.tsx'],
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
