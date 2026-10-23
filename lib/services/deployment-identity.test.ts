import { describe, expect, it, vi } from 'vitest';
import { deploymentIdentity, platformReadiness } from './deployment-identity';

const identity = {
  LUUFI_COMMIT_SHA: 'a'.repeat(40),
  LUUFI_ENVIRONMENT: 'preview',
  LUUFI_SOURCE_BRANCH: 'develop',
};
describe('LUUFI-2 Plattformidentität und Bereitschaft', () => {
  it.each([
    {},
    { ...identity, LUUFI_COMMIT_SHA: 'short' },
    { ...identity, LUUFI_ENVIRONMENT: 'other' },
    { ...identity, LUUFI_SOURCE_BRANCH: '' },
    { ...identity, LUUFI_SOURCE_BRANCH: 'bad branch' },
    { ...identity, LUUFI_ENVIRONMENT: 'production' },
  ])(
    'verwirft unvollständige oder widersprüchliche Identität %j',
    (bindings) => {
      expect(deploymentIdentity(bindings)).toBeNull();
    },
  );
  it('liefert den tatsächlichen Branch und normalisierte SHA', () => {
    expect(
      deploymentIdentity({
        ...identity,
        LUUFI_COMMIT_SHA: ` ${'A'.repeat(40)} `,
        LUUFI_SOURCE_BRANCH: 'codex/foundation',
      }),
    ).toEqual({
      commitSha: 'a'.repeat(40),
      environment: 'preview',
      sourceBranch: 'codex/foundation',
    });
    expect(
      deploymentIdentity({
        ...identity,
        LUUFI_ENVIRONMENT: 'production',
        LUUFI_SOURCE_BRANCH: 'main',
      })?.environment,
    ).toBe('production');
    expect(
      deploymentIdentity({ ...identity, LUUFI_SOURCE_BRANCH: 'main' })
        ?.sourceBranch,
    ).toBe('main');
  });
  it('prüft die Verbindung und echte Ideentabelle ohne Inhaltslesen oder Token', async () => {
    const prepare = vi.fn().mockReturnValue({
      first: vi.fn().mockResolvedValue({ ready: 1 }),
      all: vi.fn().mockResolvedValue({ results: [] }),
    });
    const DB = { prepare } as unknown as D1Database;
    expect(await platformReadiness({ ...identity, DB })).toMatchObject({
      status: 'ok',
      commitSha: 'a'.repeat(40),
    });
    expect(prepare.mock.calls.map(([sql]) => sql)).toEqual(
      expect.arrayContaining([
        'SELECT 1 AS ready',
        'SELECT id, idea_text, detail, created_at, revision FROM project_ideas LIMIT 0',
        'SELECT request_key, operation, payload_json, result_json FROM idea_mutation_requests LIMIT 0',
      ]),
    );
    expect(prepare.mock.calls.every(([sql]) => sql.startsWith('SELECT '))).toBe(
      true,
    );
    expect(await platformReadiness({ DB })).toEqual({ status: 'unavailable' });
  });
  it.each([null, { ready: 0 }])(
    'meldet fehlende Verbindung %j',
    async (value) => {
      const DB = {
        prepare: () => ({ first: async () => value }),
      } as unknown as D1Database;
      expect(await platformReadiness({ ...identity, DB })).toEqual({
        status: 'unavailable',
      });
    },
  );
  it('bereinigt Datenbankfehler', async () => {
    const DB = {
      prepare: () => {
        throw new Error('PRIVATE');
      },
    } as unknown as D1Database;
    expect(await platformReadiness({ ...identity, DB })).toEqual({
      status: 'unavailable',
    });
  });
});
