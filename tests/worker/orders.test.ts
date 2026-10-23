import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createOrder,
  getOrder,
  listOrders,
  updateDraftOrder,
} from '@/lib/services/orders';
import type { OrderSpec, OrderType } from '@/lib/domain/planning';

const actor = 'synthetic-owner';
const draft = (title = 'Ein Auftrag') => ({
  type: 'feature' as const,
  spec: {
    title,
    goal: 'Ein beobachtbares Ziel',
    origin: 'Synthetisches Feedback',
  },
});
async function project(key = 'APP', counter = 1) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO planning_projects(id,project_key,name,repository,integration_branch,production_branch,documentation_paths,deployment_hints,next_order_number) VALUES (?,?,?,'owner/repository','develop','main','[]','',?)`,
  )
    .bind(id, key, `Projekt ${key}`, counter)
    .run();
  return id;
}
async function projectState(id: string) {
  return env.DB.prepare(
    'SELECT next_order_number,planning_revision,revision FROM planning_projects WHERE id=?',
  )
    .bind(id)
    .first();
}

describe('LUUFI-6 dauerhafte Aufträge und unveränderliche Fassungen', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await env.DB.prepare(
      'DROP TRIGGER IF EXISTS reject_planning_receipt',
    ).run();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM planning_requests'),
      env.DB.prepare('DELETE FROM planning_order_relations'),
      env.DB.prepare('DELETE FROM planning_order_versions'),
      env.DB.prepare('DELETE FROM planning_orders'),
      env.DB.prepare('DELETE FROM planning_milestones'),
      env.DB.prepare('DELETE FROM planning_projects'),
    ]);
  });

  it('erstellt einen eigenständigen ungeplanten Entwurf mit vollständigen leeren Standardfeldern', async () => {
    const id = await project();
    expect(await listOrders(actor, id)).toEqual({
      items: [],
      nextCursor: null,
    });
    const order = await createOrder(actor, id, draft(), 'create');
    expect(order).toMatchObject({
      projectId: id,
      number: 1,
      displayId: 'APP-1',
      type: 'feature',
      status: 'draft',
      revision: 0,
      specVersion: 1,
      milestoneId: null,
      position: 0,
      relations: [],
    });
    expect(order.spec).toEqual({
      ...draft().spec,
      problem: '',
      scope: '',
      exclusions: '',
      flows: '',
      criteria: [],
      testStrategy: '',
      prerequisites: '',
      documentation: '',
      context: { repositoryCommit: '', documentationPolicy: '' },
      sources: [],
    });
    expect(order.history).toEqual([
      {
        version: 1,
        spec: order.spec,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      },
    ]);
    expect(await getOrder(actor, id, order.id)).toEqual(order);
    expect(await listOrders(actor, id)).toEqual({
      items: [order],
      nextCursor: null,
    });
    expect(await projectState(id)).toEqual({
      next_order_number: 2,
      planning_revision: 1,
      revision: 0,
    });
  });

  it('vergibt parallele Nummern atomar und reserviert den LUUFI-Bootstrapbereich', async () => {
    const id = await project('LUUFI', 10);
    const orders = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        createOrder(actor, id, draft(`Auftrag ${index}`), `parallel-${index}`),
      ),
    );
    expect(orders.map((order) => order.number).sort((a, b) => a - b)).toEqual([
      10, 11, 12, 13, 14, 15,
    ]);
    expect(new Set(orders.map((order) => order.id)).size).toBe(6);
    expect(await projectState(id)).toEqual({
      next_order_number: 16,
      planning_revision: 6,
      revision: 0,
    });
    expect(
      (await listOrders(actor, id)).items.map((order) => order.number),
    ).toEqual([10, 11, 12, 13, 14, 15]);
  });

  it('wiederholt denselben parallelen Erstellungsaufruf ohne weitere Nummernvergabe', async () => {
    const id = await project();
    const created = await Promise.all([
      createOrder(actor, id, draft(), 'same'),
      createOrder(actor, id, draft(), 'same'),
    ]);
    expect(created[0]).toEqual(created[1]);
    expect(await projectState(id)).toEqual({
      next_order_number: 2,
      planning_revision: 1,
      revision: 0,
    });
    await expect(
      createOrder(actor, id, draft('Anderer Inhalt'), 'same'),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      createOrder('other-owner', id, draft(), 'same'),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('speichert jede Entwurfsänderung als neue unveränderliche Fassung und spielt alte Antworten wieder ab', async () => {
    const id = await project();
    const first = await createOrder(actor, id, draft(), 'original-create');
    const updated = await updateDraftOrder(
      actor,
      id,
      first.id,
      {
        type: 'technical',
        spec: {
          ...draft('Neue Fassung').spec,
          criteria: [{ id: 'AC-1', text: 'Ein überprüfbares Ergebnis' }],
          context: {
            repositoryCommit: 'a'.repeat(40),
            documentationPolicy: '1.0.0',
          },
          sources: ['feedback-1'],
        },
      },
      0,
      'update',
    );
    expect(updated).toMatchObject({
      id: first.id,
      displayId: first.displayId,
      number: first.number,
      specVersion: 2,
      revision: 1,
      type: 'technical',
    });
    expect(updated.history[0]).toEqual(first.history[0]);
    expect(updated.history.map((version) => version.version)).toEqual([1, 2]);
    expect(updated.history[1].spec).toEqual(updated.spec);
    expect(await createOrder(actor, id, draft(), 'original-create')).toEqual(
      first,
    );
    expect(await projectState(id)).toEqual({
      next_order_number: 2,
      planning_revision: 2,
      revision: 0,
    });
    const third = await updateDraftOrder(
      actor,
      id,
      first.id,
      draft('Fassung drei'),
      1,
      'third',
    );
    expect(third.history.map((version) => version.version)).toEqual([1, 2, 3]);
    await expect(
      updateDraftOrder(actor, id, first.id, draft('Veraltet'), 0, 'stale'),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect((await getOrder(actor, id, first.id)).spec.title).toBe(
      'Fassung drei',
    );
  });

  it('liefert den ursprünglichen Änderungsbeleg nach weiterem Fortschritt', async () => {
    const id = await project();
    const first = await createOrder(actor, id, draft(), 'create');
    const second = await updateDraftOrder(
      actor,
      id,
      first.id,
      draft('Zweite Fassung'),
      0,
      'second',
    );
    await updateDraftOrder(
      actor,
      id,
      first.id,
      draft('Dritte Fassung'),
      1,
      'third',
    );
    expect(
      await updateDraftOrder(
        actor,
        id,
        first.id,
        draft('Zweite Fassung'),
        0,
        'second',
      ),
    ).toEqual(second);
    await expect(
      updateDraftOrder(
        actor,
        id,
        first.id,
        draft('Falscher Inhalt'),
        0,
        'second',
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('verhindert verlorene Spezifikationsänderungen durch parallele Revisionsprüfung', async () => {
    const id = await project();
    const first = await createOrder(actor, id, draft(), 'create');
    const updates = await Promise.allSettled([
      updateDraftOrder(actor, id, first.id, draft('A'), 0, 'a'),
      updateDraftOrder(actor, id, first.id, draft('B'), 0, 'b'),
    ]);
    expect(
      updates.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      updates.filter((result) => result.status === 'rejected'),
    ).toMatchObject([{ reason: { code: 'conflict' } }]);
    expect((await getOrder(actor, id, first.id)).history).toHaveLength(2);
  });

  it.each(['ready', 'implementing', 'implemented', 'done', 'archived'])(
    'schützt die Spezifikation ab Zustand %s',
    async (status) => {
      const id = await project();
      const first = await createOrder(actor, id, draft(), 'create');
      await env.DB.prepare('UPDATE planning_orders SET status=? WHERE id=?')
        .bind(status, first.id)
        .run();
      await expect(
        updateDraftOrder(
          actor,
          id,
          first.id,
          draft('Verbotene Änderung'),
          0,
          'update',
        ),
      ).rejects.toMatchObject({ code: 'conflict' });
      const current = await getOrder(actor, id, first.id);
      expect(current.spec).toEqual(first.spec);
      expect(current.history).toEqual(first.history);
      expect(current.status).toBe(status);
      expect(await createOrder(actor, id, draft(), 'create')).toEqual(first);
    },
  );

  it('prüft den Spezifikationsstatus erneut innerhalb des atomaren Guards', async () => {
    const id = await project();
    const first = await createOrder(actor, id, draft(), 'create');
    const batch = env.DB.batch.bind(env.DB);
    vi.spyOn(env.DB, 'batch').mockImplementationOnce(async (statements) => {
      await env.DB.prepare(
        "UPDATE planning_orders SET status='implementing' WHERE id=?",
      )
        .bind(first.id)
        .run();
      return batch(statements);
    });
    await expect(
      updateDraftOrder(actor, id, first.id, draft('Race'), 0, 'race'),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect((await getOrder(actor, id, first.id)).history).toHaveLength(1);
  });

  it('rollt bei fehlgeschlagenem Beleg Nummer, neue Fassung und Planrevision vollständig zurück', async () => {
    const id = await project();
    const first = await createOrder(actor, id, draft(), 'create');
    await env.DB.prepare(
      "CREATE TRIGGER reject_planning_receipt BEFORE UPDATE OF result_json ON planning_requests BEGIN SELECT RAISE(ABORT, 'PRIVATE'); END",
    ).run();
    await expect(
      createOrder(actor, id, draft('Nicht speichern'), 'rollback-create'),
    ).rejects.toMatchObject({ code: 'unavailable' });
    await expect(
      updateDraftOrder(
        actor,
        id,
        first.id,
        draft('Nicht speichern'),
        0,
        'rollback-update',
      ),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect(await getOrder(actor, id, first.id)).toEqual(first);
    expect(await projectState(id)).toEqual({
      next_order_number: 2,
      planning_revision: 1,
      revision: 0,
    });
    await env.DB.prepare('DROP TRIGGER reject_planning_receipt').run();
    expect(
      (await createOrder(actor, id, draft('Nächste'), 'next')).number,
    ).toBe(2);
  });

  it('filtert und paginiert projektbezogen und weist veraltete oder fremde Cursor zurück', async () => {
    const id = await project();
    const foreign = await project('OTHER');
    await createOrder(actor, foreign, draft('Nicht sichtbar'), 'foreign');
    const first = await createOrder(actor, id, draft('A'), 'a');
    await createOrder(actor, id, { ...draft('B'), type: 'defect' }, 'b');
    await createOrder(actor, id, draft('C'), 'c');
    const page = await listOrders(actor, id, { limit: 2 });
    expect(page.items.map((order) => order.number)).toEqual([1, 2]);
    expect(
      (
        await listOrders(actor, id, { limit: 2, cursor: page.nextCursor })
      ).items.map((order) => order.number),
    ).toEqual([3]);
    expect(
      (
        await listOrders(actor, id, {
          type: 'feature',
          status: 'draft',
          milestoneId: null,
        })
      ).items.map((order) => order.number),
    ).toEqual([1, 3]);
    expect(
      (await listOrders(actor, id, { milestoneId: 'missing' })).items,
    ).toEqual([]);
    await expect(
      listOrders(actor, foreign, { cursor: page.nextCursor }),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(
      listOrders(actor, id, { type: 'defect', cursor: page.nextCursor }),
    ).rejects.toMatchObject({ code: 'validation' });
    await updateDraftOrder(actor, id, first.id, draft('Neu'), 0, 'edit');
    await expect(
      listOrders(actor, id, { cursor: page.nextCursor }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(getOrder(actor, foreign, first.id)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('erkennt eine gleichzeitige Listenänderung zwischen Cursorprüfung und Snapshot', async () => {
    const id = await project();
    await createOrder(actor, id, draft(), 'create');
    const batch = env.DB.batch.bind(env.DB);
    vi.spyOn(env.DB, 'batch').mockImplementationOnce(async (statements) => {
      await env.DB.prepare(
        'UPDATE planning_projects SET planning_revision=planning_revision+1 WHERE id=?',
      )
        .bind(id)
        .run();
      return batch(statements);
    });
    await expect(listOrders(actor, id)).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it.each([
    {},
    { type: 'unknown', spec: draft().spec },
    { ...draft(), status: 'done' },
    { type: 'feature', spec: {} },
    { ...draft(), spec: { ...draft().spec, title: 'x'.repeat(281) } },
    { ...draft(), spec: { ...draft().spec, goal: ' ' } },
    { ...draft(), spec: { ...draft().spec, problem: 'x'.repeat(4001) } },
    {
      ...draft(),
      spec: {
        ...draft().spec,
        criteria: [
          { id: 'same', text: 'A' },
          { id: 'same', text: 'B' },
        ],
      },
    },
    {
      ...draft(),
      spec: { ...draft().spec, criteria: [{ id: 'x'.repeat(65), text: 'A' }] },
    },
    {
      ...draft(),
      spec: {
        ...draft().spec,
        criteria: [{ id: 'AC', text: 'x'.repeat(1001) }],
      },
    },
    {
      ...draft(),
      spec: {
        ...draft().spec,
        criteria: Array.from({ length: 51 }, (_, i) => ({
          id: `${i}`,
          text: 'A',
        })),
      },
    },
    {
      ...draft(),
      spec: { ...draft().spec, sources: Array(51).fill('source') },
    },
    { ...draft(), spec: { ...draft().spec, sources: ['x'.repeat(1001)] } },
    {
      ...draft(),
      spec: { ...draft().spec, context: { repositoryCommit: 'short' } },
    },
    {
      ...draft(),
      spec: {
        ...draft().spec,
        context: { documentationPolicy: 'x'.repeat(33) },
      },
    },
    { ...draft(), spec: { ...draft().spec, actor: 'injected' } },
  ])(
    'weist ungültige Spezifikationen und Statusinjektion zurück: %j',
    async (input) => {
      const id = await project();
      await expect(
        createOrder(
          actor,
          id,
          input as { type: OrderType; spec: Partial<OrderSpec> },
          'invalid',
        ),
      ).rejects.toMatchObject({ code: 'validation' });
      expect(await projectState(id)).toMatchObject({
        next_order_number: 1,
        planning_revision: 0,
      });
    },
  );

  it('verlangt Identität, vorhandene Ziele und sichere Revisions-/Wiederholungseingaben', async () => {
    const id = await project();
    for (const operation of [
      () => createOrder('', id, draft(), 'k'),
      () => getOrder(' ', id, 'missing'),
      () => listOrders('', id),
      () => updateDraftOrder('', id, 'missing', draft(), 0, 'k'),
    ]) {
      await expect(operation()).rejects.toMatchObject({ code: 'unauthorized' });
    }
    await expect(
      createOrder(actor, 'missing', draft(), 'missing'),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(listOrders(actor, 'missing')).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(getOrder(actor, id, 'missing')).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      updateDraftOrder(actor, id, 'missing', draft(), 0, 'missing-update'),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      updateDraftOrder(actor, id, 'missing', draft(), -1, 'bad'),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(
      createOrder(actor, id, draft(), 'bad key'),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(listOrders(actor, id, { limit: 0 })).rejects.toMatchObject({
      code: 'validation',
    });
    await expect(
      listOrders(actor, id, { cursor: 'invalid' }),
    ).rejects.toMatchObject({ code: 'validation' });
  });
});
