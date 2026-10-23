import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { siteIdentity } from '@/lib/auth/site';
import { getD1 } from '@/lib/data/d1';

describe('LUUFI-2 private identity boundary', () => {
  it('accepts only bounded Sites identity and does not trust metadata headers', () => {
    expect(
      siteIdentity(
        new Request('https://luufi.test', {
          headers: { 'oai-authenticated-user-id': ' owner ' },
        }),
      ),
    ).toBe('owner');
    for (const identity of ['', ' ', 'x'.repeat(257)])
      expect(
        siteIdentity(
          new Request('https://luufi.test', {
            headers: {
              'oai-authenticated-user-id': identity,
              'x-openai-subject': 'forged',
            },
          }),
        ),
      ).toBeNull();
  });
  it('limits synthetic test identity to the explicit local mode and loopback', () => {
    const original = {
      environment: env.LUUFI_ENVIRONMENT,
      mode: env.LUUFI_LOCAL_TEST_MODE,
    };
    try {
      env.LUUFI_LOCAL_TEST_MODE = '1';
      for (const environment of ['production', 'preview', undefined]) {
        env.LUUFI_ENVIRONMENT = environment;
        expect(siteIdentity(new Request('http://127.0.0.1:4175'))).toBeNull();
      }
      env.LUUFI_ENVIRONMENT = 'local';
      expect(siteIdentity(new Request('http://127.0.0.1:4175'))).toBe(
        'local-test-owner',
      );
      expect(siteIdentity(new Request('http://localhost:4175'))).toBe(
        'local-test-owner',
      );
      expect(siteIdentity(new Request('https://luufi.test'))).toBeNull();
      env.LUUFI_LOCAL_TEST_MODE = '0';
      expect(siteIdentity(new Request('http://localhost:4175'))).toBeNull();
    } finally {
      env.LUUFI_ENVIRONMENT = original.environment;
      env.LUUFI_LOCAL_TEST_MODE = original.mode;
    }
  });
  it('fails explicitly when the configured database is missing', () => {
    expect(getD1()).toBe(env.DB);
    const database = env.DB;
    try {
      Object.assign(env, { DB: undefined });
      expect(getD1).toThrow('D1 binding DB is unavailable.');
    } finally {
      env.DB = database;
    }
  });
});
