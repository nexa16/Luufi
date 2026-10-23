import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/health/route';

describe('LUUFI-2 geschützter Health-Endpunkt', () => {
  afterEach(() => vi.restoreAllMocks());
  it('verlangt Sites-Benutzeridentität und veröffentlicht keine Daten anonym', async () => {
    const response = await GET(new Request('https://luufi.test/api/health'));
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('commitSha');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('liefert nach Anmeldung die genaue Identität ohne GitHub-Token', async () => {
    const response = await GET(
      new Request('https://luufi.test/api/health', {
        headers: { 'oai-authenticated-user-id': 'owner' },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      commitSha: env.LUUFI_COMMIT_SHA,
      environment: env.LUUFI_ENVIRONMENT,
      sourceBranch: env.LUUFI_SOURCE_BRANCH,
    });
  });
  it('liefert bei D1-Ausfall einen bereinigten Fehler', async () => {
    vi.spyOn(env.DB, 'prepare').mockImplementation(() => {
      throw new Error('PRIVATE');
    });
    const response = await GET(
      new Request('https://luufi.test/api/health', {
        headers: { 'oai-authenticated-user-id': 'owner' },
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable' });
  });
});
