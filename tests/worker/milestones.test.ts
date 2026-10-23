import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMilestone,
  getMilestone,
  listMilestones,
  moveMilestone,
  updateMilestone,
} from '@/lib/services/milestones';

const actor = 'synthetic-owner';
async function project(id = crypto.randomUUID()) {
  await env.DB.prepare(
    "INSERT INTO planning_projects(id, project_key, name, repository, integration_branch, production_branch, documentation_paths, deployment_hints) VALUES (?, ?, 'Testprojekt', 'https://example.test/repository', 'develop', 'main', '[]', '')",
  )
    .bind(id, id)
    .run();
  return id;
}
async function planRevision(id: string) {
  return (await env.DB.prepare(
    'SELECT planning_revision FROM planning_projects WHERE id = ?',
  )
    .bind(id)
    .first<{ planning_revision: number }>())!.planning_revision;
}
const create = (projectId: string, title: string, key = crypto.randomUUID()) =>
  createMilestone(actor, projectId, { title }, key);
async function ids(projectId: string) {
  return (await listMilestones(actor, projectId)).items.map((item) => item.id);
}

describe('LUUFI-5 Milestones mit migrierter D1', () => {
  it.each(['update', 'move'] as const)(
    'liefert Replay, wenn derselbe %s nach Receiptmiss vor der Vorprüfung committed',
    async (operation) => {
      const id = await project();
      const initial = await create(id, 'Vorher');
      const key = 'raced-identical';
      const run = () =>
        operation === 'update'
          ? updateMilestone(actor, id, initial.id, { title: 'Nachher' }, 0, key)
          : moveMilestone(actor, id, initial.id, null, 1, key);
      const prepare = env.DB.prepare.bind(env.DB);
      let intercepted = false;
      let committed: unknown;
      vi.spyOn(env.DB, 'prepare').mockImplementation((query) => {
        const statement = prepare(query);
        if (
          !query.startsWith(
            'SELECT actor, operation, payload_json, result_json',
          )
        )
          return statement;
        return {
          bind: (...params: unknown[]) => ({
            first: async () => {
              const receipt = await statement.bind(...params).first();
              if (!intercepted && params[0] === key) {
                intercepted = true;
                expect(receipt).toBeNull();
                committed = await run();
              }
              return receipt;
            },
          }),
        } as unknown as D1PreparedStatement;
      });
      expect(await run()).toEqual(committed);
      expect(intercepted).toBe(true);
      expect(await planRevision(id)).toBe(2);
      expect((await getMilestone(actor, id, initial.id)).revision).toBe(1);
    },
  );
  afterEach(async () => {
    vi.restoreAllMocks();
    await env.DB.prepare(
      'DROP TRIGGER IF EXISTS reject_milestone_receipt',
    ).run();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM planning_requests'),
      env.DB.prepare('DELETE FROM planning_milestones'),
      env.DB.prepare('DELETE FROM planning_projects'),
    ]);
  });
  it('liefert leere Projekte ehrlich und erhält Projektgrenzen', async () => {
    const id = await project();
    expect(await listMilestones(actor, id)).toEqual({
      items: [],
      nextCursor: null,
    });
    const first = await create(id, 'Erster Milestone');
    const other = await project();
    expect(await getMilestone(actor, id, first.id)).toEqual(first);
    await expect(getMilestone(actor, other, first.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      listMilestones(actor, 'missing-project'),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(create('missing-project', 'Fehlt')).rejects.toMatchObject({
      code: 'not_found',
    });
  });
  it('erstellt offene Milestones angehängt und speichert normalisierte Inhalte', async () => {
    const id = await project();
    const first = await createMilestone(
      actor,
      id,
      { title: '  Eins  ', description: '\nBeschreibung\n' },
      'first',
    );
    const second = await create(id, 'Eins');
    expect(first).toMatchObject({
      projectId: id,
      title: 'Eins',
      description: 'Beschreibung',
      state: 'open',
      position: 0,
      revision: 0,
    });
    expect(second).toMatchObject({ position: 1, state: 'open', revision: 0 });
    expect(second.id).not.toBe(first.id);
    expect(await planRevision(id)).toBe(2);
  });
  it('wiederholt Erstellen und Bearbeiten nach späterer Änderung exakt', async () => {
    const id = await project();
    const initial = await create(id, 'Erster Stand', 'create');
    const changed = await updateMilestone(
      actor,
      id,
      initial.id,
      { title: 'Zweiter Stand', description: 'Details' },
      0,
      'update',
    );
    expect(changed).toMatchObject({
      id: initial.id,
      position: 0,
      revision: 1,
      title: 'Zweiter Stand',
    });
    expect(await create(id, 'Erster Stand', 'create')).toEqual(initial);
    await updateMilestone(
      actor,
      id,
      initial.id,
      { title: 'Dritter Stand' },
      1,
      'update-again',
    );
    expect(
      await updateMilestone(
        actor,
        id,
        initial.id,
        { title: 'Zweiter Stand', description: 'Details' },
        0,
        'update',
      ),
    ).toEqual(changed);
    expect(await planRevision(id)).toBe(3);
    await expect(create(id, 'Anderer Inhalt', 'create')).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(
      createMilestone('other-owner', id, { title: 'Erster Stand' }, 'create'),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      updateMilestone(
        actor,
        id,
        initial.id,
        { title: 'Erster Stand' },
        0,
        'create',
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
  it('weist veraltete Bearbeitung und geschlossene Ziele ohne Nebenwirkungen ab', async () => {
    const id = await project();
    const initial = await create(id, 'Offen');
    await expect(
      updateMilestone(actor, id, initial.id, { title: 'Alt' }, 1, 'stale'),
    ).rejects.toMatchObject({ code: 'conflict' });
    await env.DB.prepare(
      "UPDATE planning_milestones SET state = 'closed' WHERE id = ?",
    )
      .bind(initial.id)
      .run();
    await expect(
      updateMilestone(
        actor,
        id,
        initial.id,
        { title: 'Zu' },
        0,
        'closed-update',
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      moveMilestone(actor, id, initial.id, null, 1, 'closed-move'),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await planRevision(id)).toBe(1);
    expect(await getMilestone(actor, id, initial.id)).toMatchObject({
      title: 'Offen',
      state: 'closed',
      revision: 0,
    });
    expect(
      await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM planning_requests',
      ).first(),
    ).toEqual({ count: 1 });
    await expect(
      updateMilestone(actor, id, 'missing', { title: 'Fehlt' }, 0, 'missing'),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
  it('ordnet vor einem Anker und am Ende, reindiziert lückenlos und spielt Moves erneut ab', async () => {
    const id = await project();
    const one = await create(id, 'Eins');
    const two = await create(id, 'Zwei');
    const three = await create(id, 'Drei');
    await env.DB.prepare(
      "UPDATE planning_milestones SET state = 'closed' WHERE id = ?",
    )
      .bind(two.id)
      .run();
    const moved = await moveMilestone(
      actor,
      id,
      three.id,
      one.id,
      3,
      'move-front',
    );
    expect(moved).toMatchObject({ id: three.id, position: 0, revision: 1 });
    expect(await ids(id)).toEqual([three.id, one.id, two.id]);
    expect(
      (await listMilestones(actor, id)).items.map((item) => item.position),
    ).toEqual([0, 1, 2]);
    expect(await getMilestone(actor, id, two.id)).toMatchObject({
      state: 'closed',
      position: 2,
      revision: 0,
    });
    await moveMilestone(actor, id, three.id, null, 4, 'move-end');
    expect(await ids(id)).toEqual([one.id, two.id, three.id]);
    expect(
      await moveMilestone(actor, id, three.id, one.id, 3, 'move-front'),
    ).toEqual(moved);
    expect(await planRevision(id)).toBe(5);
    expect(
      (await listMilestones(actor, id)).items.find(
        (item) => item.state === 'open',
      )?.id,
    ).toBe(one.id);
  });
  it('schützt Anker, Projektzuordnung und gemeinsame Reihenfolgerevision', async () => {
    const id = await project();
    const one = await create(id, 'Eins');
    const two = await create(id, 'Zwei');
    const foreign = await create(await project(), 'Fremd');
    for (const before of [one.id, 'missing', foreign.id])
      await expect(
        moveMilestone(actor, id, one.id, before, 2, crypto.randomUUID()),
      ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      moveMilestone(actor, id, one.id, null, 0, 'stale'),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      moveMilestone(actor, id, foreign.id, null, 2, 'foreign'),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await ids(id)).toEqual([one.id, two.id]);
    expect(await planRevision(id)).toBe(2);
  });
  it('lässt nur eine konkurrierende Inhaltsänderung aus derselben Revision zu', async () => {
    const id = await project();
    const initial = await create(id, 'Anfang');
    const results = await Promise.allSettled(
      ['Eins', 'Zwei'].map((title) =>
        updateMilestone(actor, id, initial.id, { title }, 0, title),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(await getMilestone(actor, id, initial.id)).toMatchObject({
      revision: 1,
    });
    expect(await planRevision(id)).toBe(2);
  });
  it('serialisiert konkurrierendes Anhängen und schützt gleichzeitige Moves', async () => {
    const id = await project();
    const [one, two, three] = await Promise.all(
      ['Eins', 'Zwei', 'Drei'].map((title) => create(id, title)),
    );
    expect(
      (await listMilestones(actor, id)).items.map((item) => item.position),
    ).toEqual([0, 1, 2]);
    const results = await Promise.allSettled([
      moveMilestone(actor, id, one.id, two.id, 3, 'first-move'),
      moveMilestone(actor, id, three.id, two.id, 3, 'second-move'),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(await planRevision(id)).toBe(4);
    expect(
      (await listMilestones(actor, id)).items.map((item) => item.position),
    ).toEqual([0, 1, 2]);
  });
  it('bindet Cursor an Projekt und sämtliche Planungsänderungen', async () => {
    const id = await project();
    const one = await create(id, 'Eins');
    const two = await create(id, 'Zwei');
    const first = await listMilestones(actor, id, { limit: 1 });
    expect(first.items[0].id).toBe(one.id);
    expect(first.nextCursor).toBeTypeOf('string');
    expect(
      await listMilestones(actor, id, { limit: 1, cursor: first.nextCursor }),
    ).toEqual({ items: [two], nextCursor: null });
    await expect(
      listMilestones(actor, await project(), { cursor: first.nextCursor }),
    ).rejects.toMatchObject({ code: 'validation' });
    await updateMilestone(actor, id, one.id, { title: 'Neu' }, 0, 'new-title');
    await expect(
      listMilestones(actor, id, { cursor: first.nextCursor }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      listMilestones(actor, id, { cursor: 'not-json' }),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(
      listMilestones(actor, id, { limit: 51 }),
    ).rejects.toMatchObject({ code: 'validation' });
  });
  it('rollt Milestone und Planungsrevision bei fehlendem Receipt vollständig zurück', async () => {
    const id = await project();
    await env.DB.prepare(
      "CREATE TRIGGER reject_milestone_receipt BEFORE UPDATE OF result_json ON planning_requests BEGIN SELECT RAISE(ABORT, 'PRIVATE-RECEIPT'); END",
    ).run();
    await expect(
      create(id, 'Nicht gespeichert', 'rollback'),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect(await listMilestones(actor, id)).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(await planRevision(id)).toBe(0);
    expect(
      await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM planning_requests',
      ).first(),
    ).toEqual({ count: 0 });
  });
  it('verhindert ein doppeltes Anlegen bei parallelem identischem Wiederholungsschlüssel', async () => {
    const id = await project();
    const result = await Promise.all([
      create(id, 'Einmal', 'same-key'),
      create(id, 'Einmal', 'same-key'),
    ]);
    expect(result[0]).toEqual(result[1]);
    expect((await listMilestones(actor, id)).items).toHaveLength(1);
    expect(await planRevision(id)).toBe(1);
  });
  it.each(['update', 'move'])(
    'prüft ein nach dem Lesen geschlossenes Ziel im atomaren Guard: %s',
    async (operation) => {
      const id = await project();
      const initial = await create(id, 'Unverändert');
      const batch = env.DB.batch.bind(env.DB);
      vi.spyOn(env.DB, 'batch').mockImplementationOnce(async (statements) => {
        await env.DB.prepare(
          "UPDATE planning_milestones SET state = 'closed' WHERE id = ?",
        )
          .bind(initial.id)
          .run();
        return batch(statements);
      });
      const mutation =
        operation === 'update'
          ? updateMilestone(
              actor,
              id,
              initial.id,
              { title: 'Unerlaubt' },
              0,
              'raced-update',
            )
          : moveMilestone(actor, id, initial.id, null, 1, 'raced-move');
      await expect(mutation).rejects.toMatchObject({ code: 'conflict' });
      expect(await getMilestone(actor, id, initial.id)).toMatchObject({
        title: 'Unverändert',
        state: 'closed',
        revision: 0,
        position: 0,
      });
      expect(await planRevision(id)).toBe(1);
      expect(
        await env.DB.prepare(
          'SELECT COUNT(*) AS count FROM planning_requests',
        ).first(),
      ).toEqual({ count: 1 });
    },
  );
  it('verwirft eine während des Lesens geänderte Liste statt einen veralteten Cursor auszugeben', async () => {
    const id = await project();
    await create(id, 'Eintrag');
    const prepare = env.DB.prepare.bind(env.DB);
    vi.spyOn(env.DB, 'prepare').mockImplementation((query) => {
      const statement = prepare(query);
      if (!query.includes('ORDER BY position, id LIMIT')) return statement;
      return {
        bind: (...params: unknown[]) => ({
          all: async () => {
            const rows = await statement.bind(...params).all();
            await prepare(
              'UPDATE planning_projects SET planning_revision = planning_revision + 1 WHERE id = ?',
            )
              .bind(id)
              .run();
            return rows;
          },
        }),
      } as unknown as D1PreparedStatement;
    });
    await expect(listMilestones(actor, id, { limit: 1 })).rejects.toMatchObject(
      { code: 'conflict' },
    );
    vi.restoreAllMocks();
    expect((await listMilestones(actor, id)).items).toHaveLength(1);
  });
  it('validiert Identität, Inhalt, Revision und Schlüssel ohne rohe Datenbankfehler', async () => {
    const id = await project();
    const prepare = vi.spyOn(env.DB, 'prepare');
    for (const input of [
      { title: '' },
      { title: 'x'.repeat(281) },
      { title: 'Text', description: 'x'.repeat(4001) },
      { title: 'Text', actor: 'forged' },
      { title: 'Text', state: 'closed' },
    ]) {
      await expect(
        createMilestone(actor, id, input, 'invalid'),
      ).rejects.toMatchObject({ code: 'validation' });
    }
    await expect(
      createMilestone('', id, { title: 'Unbefugt' }, 'key'),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(
      createMilestone(
        actor,
        id,
        { title: 'Text', description: null } as unknown as Parameters<
          typeof createMilestone
        >[2],
        'null-description',
      ),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(getMilestone(actor, id, '')).rejects.toMatchObject({
      code: 'validation',
    });
    await expect(
      updateMilestone(actor, id, 'id', { title: 'Text' }, -1, 'key'),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(create(id, 'Text', 'bad key')).rejects.toMatchObject({
      code: 'validation',
    });
    expect(prepare).not.toHaveBeenCalled();
    prepare.mockImplementation(() => {
      throw new Error('PRIVATE-DATABASE');
    });
    await expect(listMilestones(actor, id)).rejects.toMatchObject({
      code: 'unavailable',
    });
    await expect(create(id, 'Fehler')).rejects.not.toThrow('PRIVATE');
  });
});
