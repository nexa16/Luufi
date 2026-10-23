import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { afterEach, vi } from 'vitest';
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
afterEach(() => vi.restoreAllMocks());
