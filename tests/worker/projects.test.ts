import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getProject,
  listProjects,
  registerProject,
  updateProject,
} from '@/lib/services/projects';
import { planningMutation, sql } from '@/lib/services/planning-store';

const input = { key: 'TEST', name: 'Testprojekt', repository: 'example/test' };
const register = (key = crypto.randomUUID(), value = input) =>
  registerProject('owner', value, key);
afterEach(async () => {
  await env.DB.prepare('DROP TRIGGER IF EXISTS fail_planning_receipt').run();
  await env.DB.prepare('DELETE FROM planning_requests').run();
  await env.DB.prepare('DELETE FROM planning_projects').run();
});
describe('LUUFI-4 Projekte und atomarer Planungskern', () => {
  it('registriert stabile Stammdaten und reserviert ausschließlich Luufi-Bootstrapnummern', async () => {
    const p = await register();
    expect(p).toMatchObject({
      key: 'TEST',
      integrationBranch: 'develop',
      productionBranch: 'main',
      revision: 0,
      planningRevision: 0,
      nextOrderNumber: 1,
    });
    expect(await getProject('owner', p.id)).toEqual(p);
    expect(
      (await register('luufi', { ...input, key: 'LUUFI' })).nextOrderNumber,
    ).toBe(13);
    await expect(register('duplicate')).rejects.toMatchObject({
      code: 'conflict',
    });
  });
  it('bindet Replay an Akteur, Operation und normalisierten Inhalt und erhält die alte Antwort', async () => {
    const p = await register('create');
    const updated = await updateProject(
      'owner',
      p.id,
      { ...input, name: 'Neu', key: undefined } as never,
      0,
      'bad',
    ).catch(() => null);
    expect(updated).toBeNull();
    const config = { name: 'Neu', repository: input.repository };
    const changed = await updateProject('owner', p.id, config, 0, 'update');
    expect(changed.revision).toBe(1);
    await updateProject(
      'owner',
      p.id,
      { ...config, name: 'Noch neuer' },
      1,
      'update2',
    );
    expect(await updateProject('owner', p.id, config, 0, 'update')).toEqual(
      changed,
    );
    expect(await register('create')).toEqual(p);
    await expect(
      registerProject('other', input, 'create'),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      updateProject('owner', p.id, config, 0, 'stale'),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      registerProject('owner', { ...input, name: 'Anders' }, 'create'),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
  it('verhindert konkurrierende Revisionen und duplizierte registrierte Kürzel', async () => {
    const p = await register();
    const results = await Promise.allSettled(
      ['A', 'B'].map((name) =>
        updateProject(
          'owner',
          p.id,
          { name, repository: input.repository },
          0,
          name,
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await getProject('owner', p.id)).revision).toBe(1);
  });
  it('erhält ausgelassene optionale Stammdaten und meldet fehlende Updateziele', async () => {
    const p = await registerProject(
      'owner',
      {
        ...input,
        productionBranch: 'master',
        integrationBranch: 'integration',
        documentationPaths: ['docs/custom.md'],
        deploymentHints: 'Privater Preview',
      },
      'custom',
    );
    const changed = await updateProject(
      'owner',
      p.id,
      { name: 'Neuer Name', repository: 'example/new' },
      0,
      'name-only',
    );
    expect(changed).toMatchObject({
      productionBranch: 'master',
      integrationBranch: 'integration',
      documentationPaths: ['docs/custom.md'],
      deploymentHints: 'Privater Preview',
    });
    await updateProject(
      'owner',
      p.id,
      { name: 'Später', repository: 'example/new', productionBranch: 'main' },
      1,
      'later',
    );
    expect(
      await updateProject(
        'owner',
        p.id,
        { name: 'Neuer Name', repository: 'example/new' },
        0,
        'name-only',
      ),
    ).toEqual(changed);
    await expect(
      updateProject(
        'owner',
        'missing',
        { name: 'Neu', repository: input.repository },
        0,
        'missing',
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
  it('rollt alle Schreibschritte zurück, wenn der Beleg nicht gespeichert werden kann', async () => {
    await env.DB.exec(
      "CREATE TRIGGER fail_planning_receipt BEFORE UPDATE ON planning_requests BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
    );
    await expect(register('rollback')).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect((await listProjects('owner')).items).toEqual([]);
    expect(
      await env.DB.prepare('SELECT * FROM planning_requests').first(),
    ).toBeNull();
  });
  it('bricht bei fehlender Ergebniszeile atomar ab', async () => {
    await expect(
      planningMutation({
        actor: 'owner',
        operation: 'test',
        payload: {},
        key: 'missing-result',
        guard: sql('1'),
        writes: () => [],
        result: sql('SELECT NULL'),
      }),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect(
      await env.DB.prepare('SELECT * FROM planning_requests').first(),
    ).toBeNull();
  });
  it('paginiert ohne Überspringen und weist veraltete sowie fremde Cursor ab', async () => {
    await register('a', { ...input, key: 'AA' });
    const b = await register('b', { ...input, key: 'BB' });
    const first = await listProjects('owner', { limit: 1 });
    expect(first.items[0].key).toBe('AA');
    expect(
      (await listProjects('owner', { cursor: first.nextCursor })).items[0].key,
    ).toBe('BB');
    await updateProject(
      'owner',
      b.id,
      { name: 'Neu', repository: input.repository },
      0,
      'change',
    );
    await expect(
      listProjects('owner', { cursor: first.nextCursor }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      listProjects('owner', { cursor: 'broken' }),
    ).rejects.toMatchObject({ code: 'validation' });
  });
  it.each([
    { ...input, key: 'bad-key' },
    { ...input, name: '' },
    { ...input, repository: 'https://user:password@example.test/repo' },
    { ...input, integrationBranch: '../main' },
    { ...input, productionBranch: 'other' },
    { ...input, documentationPaths: ['../secret'] },
  ])('weist ungültige Konfiguration ohne Schreibzugriff ab', async (bad) => {
    await expect(
      registerProject('owner', bad as never, 'invalid'),
    ).rejects.toMatchObject({ code: 'validation' });
    expect((await listProjects('owner')).items).toEqual([]);
  });
  it('schützt alle Zugänge und meldet fehlende Projekte ausdrücklich', async () => {
    await expect(listProjects('')).rejects.toMatchObject({
      code: 'unauthorized',
    });
    await expect(getProject('owner', 'missing')).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      registerProject('owner', input, '../bad'),
    ).rejects.toMatchObject({ code: 'validation' });
  });
});
