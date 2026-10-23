import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createProjectIdea,
  deleteProjectIdea,
  getProjectIdea,
  listProjectIdeas,
  ProjectIdeaError,
  updateProjectIdea,
} from '@/lib/services/project-ideas';

const actor = 'owner';
const content = { text: 'Neue Idee', detail: 'Beschreibung' };
const create = (key = crypto.randomUUID()) =>
  createProjectIdea(actor, content, key);

describe('LUUFI-3 gemeinsame Projektideen-D1-Services', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await env.DB.prepare('DROP TRIGGER IF EXISTS reject_idea_receipt').run();
    await env.DB.prepare('DELETE FROM idea_mutation_requests').run();
    await env.DB.prepare('DELETE FROM project_ideas').run();
  });

  it('erhält synthetische Bestands-IDs, Inhalte und Zeitstempel unverändert', async () => {
    await env.DB.prepare(
      'INSERT INTO project_ideas (id, idea_text, detail, created_at) VALUES (?, ?, ?, ?)',
    )
      .bind('legacy-id', '  Unverändert ä  ', '\nAlter Text\n', 1720000000123)
      .run();
    const old = {
      id: 'legacy-id',
      text: '  Unverändert ä  ',
      detail: '\nAlter Text\n',
      createdAt: '2024-07-03T09:46:40.123Z',
      revision: 0,
    };
    expect(await getProjectIdea(actor, 'legacy-id')).toEqual(old);
    expect(await listProjectIdeas(actor)).toEqual({
      items: [old],
      nextCursor: null,
    });
    expect(
      await env.DB.prepare(
        'SELECT id, idea_text, detail, created_at FROM project_ideas',
      ).first(),
    ).toEqual({
      id: 'legacy-id',
      idea_text: '  Unverändert ä  ',
      detail: '\nAlter Text\n',
      created_at: 1720000000123,
    });
  });

  it('persistiert doppelte Titel unabhängig und wiederholt Erstellen dauerhaft', async () => {
    const first = await create('create-1');
    const second = await create('create-2');
    expect(first.id).not.toBe(second.id);
    expect(first.revision).toBe(0);
    expect(await create('create-1')).toEqual(first);
    expect((await listProjectIdeas(actor)).items).toHaveLength(2);
    await expect(
      createProjectIdea(actor, { text: 'Anderer Inhalt' }, 'create-1'),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      createProjectIdea('other-owner', content, 'create-1'),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('ändert nur die aktuelle Revision und erhält ID und Erstellungszeit', async () => {
    const first = await create();
    const updated = await updateProjectIdea(
      actor,
      first.id,
      { text: ' Geändert ', detail: '' },
      0,
      'update-1',
    );
    expect(updated).toEqual({
      ...first,
      text: 'Geändert',
      detail: '',
      revision: 1,
    });
    expect(
      await updateProjectIdea(
        actor,
        first.id,
        { text: ' Geändert ', detail: '' },
        0,
        'update-1',
      ),
    ).toEqual(updated);
    await expect(
      updateProjectIdea(actor, first.id, content, 0, 'update-stale'),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      updateProjectIdea(actor, first.id, content, 1, 'update-1'),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await getProjectIdea(actor, first.id)).toEqual(updated);
    expect(
      await env.DB.prepare(
        'SELECT request_key FROM idea_mutation_requests WHERE request_key = ?',
      )
        .bind('update-stale')
        .first(),
    ).toBeNull();
  });

  it('lässt parallele Änderungen derselben Revision nur einmal durch', async () => {
    const first = await create();
    const results = await Promise.allSettled([
      updateProjectIdea(actor, first.id, { text: 'A' }, 0, 'parallel-a'),
      updateProjectIdea(actor, first.id, { text: 'B' }, 0, 'parallel-b'),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toMatchObject([{ reason: { code: 'conflict' } }]);
    expect((await getProjectIdea(actor, first.id)).revision).toBe(1);
  });

  it('wiederholt paralleles Erstellen mit identischem Schlüssel ohne Duplikat', async () => {
    const results = await Promise.all([
      create('parallel-create'),
      create('parallel-create'),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect((await listProjectIdeas(actor)).items).toHaveLength(1);
  });

  it('löscht revisionssicher nur die ausgewählte Idee und bewahrt Replay nach Löschung', async () => {
    const retained = await create();
    const removed = await create();
    await expect(
      deleteProjectIdea(actor, removed.id, 4, 'stale-delete'),
    ).rejects.toMatchObject({ code: 'conflict' });
    const result = { id: removed.id, deleted: true, revision: 0 };
    expect(await deleteProjectIdea(actor, removed.id, 0, 'delete-1')).toEqual(
      result,
    );
    expect(await deleteProjectIdea(actor, removed.id, 0, 'delete-1')).toEqual(
      result,
    );
    await expect(
      deleteProjectIdea(actor, removed.id, 0, 'delete-2'),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      deleteProjectIdea(actor, retained.id, 0, 'delete-1'),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect((await listProjectIdeas(actor)).items).toEqual([retained]);
  });

  it('liefert den ursprünglichen Änderungsbeleg auch nach späterem Löschen', async () => {
    const first = await create('original-create');
    const changed = await updateProjectIdea(
      actor,
      first.id,
      { text: 'Neu' },
      0,
      'original-update',
    );
    await deleteProjectIdea(actor, first.id, 1, 'remove');
    expect(await create('original-create')).toEqual(first);
    expect(
      await updateProjectIdea(
        actor,
        first.id,
        { text: 'Neu' },
        0,
        'original-update',
      ),
    ).toEqual(changed);
    expect((await listProjectIdeas(actor)).items).toEqual([]);
  });

  it('weist Wiederholungsschlüssel einer anderen Operation ohne Seiteneffekt ab', async () => {
    const first = await create('one-key');
    await expect(
      updateProjectIdea(actor, first.id, content, 0, 'one-key'),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      deleteProjectIdea(actor, first.id, 0, 'one-key'),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await getProjectIdea(actor, first.id)).toEqual(first);
  });

  it('rollt die Änderung zurück, wenn der dauerhafte Wiederholungsbeleg fehlschlägt', async () => {
    const first = await create();
    await env.DB.prepare(
      "CREATE TRIGGER reject_idea_receipt BEFORE INSERT ON idea_mutation_requests BEGIN SELECT RAISE(ABORT, 'PRIVATE DATABASE DETAIL'); END",
    ).run();
    await expect(
      updateProjectIdea(
        actor,
        first.id,
        { text: 'Nicht speichern' },
        0,
        'rollback',
      ),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect(await getProjectIdea(actor, first.id)).toEqual(first);
    await expect(create('rollback-create')).rejects.toMatchObject({
      code: 'unavailable',
    });
    await expect(
      deleteProjectIdea(actor, first.id, 0, 'rollback-delete'),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect((await listProjectIdeas(actor)).items).toEqual([first]);
  });

  it('paginiert per Zeitstempel und ID stabil über gleiche Zeitstempel', async () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      await env.DB.prepare(
        'INSERT INTO project_ideas (id, idea_text, detail, created_at) VALUES (?, ?, ?, ?)',
      )
        .bind(id, id, '', id === 'e' ? 20 : 10)
        .run();
    }
    const first = await listProjectIdeas(actor, { limit: 2 });
    expect(first.items.map((row) => row.id)).toEqual(['e', 'd']);
    const second = await listProjectIdeas(actor, {
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.items.map((row) => row.id)).toEqual(['c', 'b']);
    await env.DB.prepare(
      "INSERT INTO project_ideas (id, idea_text, detail, created_at) VALUES ('newer', 'neu', '', 30)",
    ).run();
    const third = await listProjectIdeas(actor, {
      limit: 2,
      cursor: second.nextCursor,
    });
    expect(third.items.map((row) => row.id)).toEqual(['a']);
    expect(third.nextCursor).toBeNull();
  });

  it('verwendet standardmäßig 25 Einträge und begrenzt auf höchstens 50', async () => {
    await env.DB.batch(
      Array.from({ length: 51 }, (_, index) =>
        env.DB.prepare(
          'INSERT INTO project_ideas (id, idea_text, detail, created_at) VALUES (?, ?, ?, ?)',
        ).bind(`id-${index}`, 'Text', '', index),
      ),
    );
    expect((await listProjectIdeas(actor)).items).toHaveLength(25);
    expect((await listProjectIdeas(actor, { limit: 50 })).items).toHaveLength(
      50,
    );
    expect((await listProjectIdeas(actor, { limit: 1 })).items).toHaveLength(1);
  });

  it.each([0, 51, 1.5, NaN])(
    'weist ungültige Seitengröße %s ab',
    async (limit) => {
      await expect(listProjectIdeas(actor, { limit })).rejects.toMatchObject({
        code: 'validation',
      });
    },
  );
  it.each([
    '',
    '%',
    btoa('{}'),
    btoa('[1]'),
    btoa('[1,2]'),
    btoa('[1,""]'),
    btoa('[1.2,"id"]'),
    'a'.repeat(1025),
  ])('weist ungültigen Cursor ab: %s', async (cursor) => {
    await expect(listProjectIdeas(actor, { cursor })).rejects.toMatchObject({
      code: 'validation',
    });
  });

  it('verlangt Identität, Eingabe, Revision und Wiederholungsschlüssel', async () => {
    for (const operation of [
      () => listProjectIdeas(' '),
      () => getProjectIdea('', 'id'),
      () => createProjectIdea('', content, 'key'),
      () => updateProjectIdea('', 'id', content, 0, 'key'),
      () => deleteProjectIdea('', 'id', 0, 'key'),
    ]) {
      await expect(operation()).rejects.toMatchObject({
        code: 'unauthorized',
        status: 401,
      });
    }
    await expect(
      createProjectIdea(actor, { text: '' }, 'valid'),
    ).rejects.toMatchObject({ code: 'validation', status: 400 });
    for (const key of [
      '',
      'a b',
      'a'.repeat(129),
      undefined as unknown as string,
    ]) {
      await expect(
        createProjectIdea(actor, content, key),
      ).rejects.toMatchObject({ code: 'validation' });
    }
    for (const rev of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(
        updateProjectIdea(actor, 'id', content, rev, 'key'),
      ).rejects.toMatchObject({ code: 'validation' });
      await expect(
        deleteProjectIdea(actor, 'id', rev, 'key'),
      ).rejects.toMatchObject({ code: 'validation' });
    }
    await expect(getProjectIdea(actor, ' ')).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
    });
    await expect(getProjectIdea(actor, 'missing')).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      updateProjectIdea(actor, 'missing', content, 0, 'missing'),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('bereinigt Datenbankfehler für Leser und Ersteller', async () => {
    vi.spyOn(env.DB, 'prepare').mockImplementation(() => {
      throw new Error('PRIVATE');
    });
    for (const operation of [
      () => listProjectIdeas(actor),
      () => getProjectIdea(actor, 'id'),
      () => create(),
      () => updateProjectIdea(actor, 'id', content, 0, 'key'),
      () => deleteProjectIdea(actor, 'id', 0, 'key'),
    ]) {
      await expect(operation()).rejects.toMatchObject({
        code: 'unavailable',
        status: 503,
        message: expect.not.stringContaining('PRIVATE'),
      });
    }
    expect(new ProjectIdeaError('conflict', 'Konflikt').status).toBe(409);
  });
});
