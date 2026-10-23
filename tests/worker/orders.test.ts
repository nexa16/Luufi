import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createOrder,
  getOrder,
  listOrders,
  updateDraftOrder,
  placeOrder,
  setOrderRelation,
  removeOrderRelation,
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
async function planningRevision(id: string) {
  return (await env.DB.prepare(
    'SELECT planning_revision FROM planning_projects WHERE id=?',
  )
    .bind(id)
    .first<{ planning_revision: number }>())!.planning_revision;
}
async function milestone(projectId: string, title = 'Milestone') {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO planning_milestones(id,project_id,title,description,position) VALUES (?,?,?,'',0)",
  )
    .bind(id, projectId, title)
    .run();
  return id;
}

describe('LUUFI-6/7 dauerhafte Aufträge, Planung und Beziehungen', () => {
  it.each(['place', 'remove'] as const)(
    'liefert Replay, wenn dasselbe %s nach Receiptmiss vor der Vorprüfung committed',
    async (operation) => {
      const id = await project();
      let a = await createOrder(actor, id, draft('A'), 'a');
      const b = await createOrder(actor, id, draft('B'), 'b');
      if (operation === 'remove')
        a = await setOrderRelation(actor, id, a.id, b.id, 'related', 0, 'edge');
      const plan = await planningRevision(id);
      const key = 'raced-identical';
      const run = () =>
        operation === 'place'
          ? placeOrder(actor, id, a.id, null, null, a.revision, plan, key)
          : removeOrderRelation(
              actor,
              id,
              a.id,
              b.id,
              'related',
              a.revision,
              key,
            );
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
      expect(await planningRevision(id)).toBe(plan + 1);
      expect((await getOrder(actor, id, a.id)).revision).toBe(a.revision + 1);
    },
  );
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
  describe('LUUFI-7 Platzierung und gerichtete Beziehungen', () => {
    it('ordnet Aufträge zwischen Gruppen ein und reindexiert betroffene Reihenfolgen ohne neue Spezifikation', async () => {
      const id = await project();
      const a = await createOrder(actor, id, draft('A'), 'a');
      const b = await createOrder(actor, id, draft('B'), 'b');
      const c = await createOrder(actor, id, draft('C'), 'c');
      const m = await milestone(id);
      const firstPlan = await planningRevision(id);
      const moved = await placeOrder(
        actor,
        id,
        b.id,
        m,
        null,
        0,
        firstPlan,
        'place-b',
      );
      expect(moved).toMatchObject({
        id: b.id,
        milestoneId: m,
        revision: 1,
        position: 0,
        specVersion: 1,
        history: b.history,
        spec: b.spec,
      });
      expect(
        (await listOrders(actor, id, { milestoneId: null })).items.map(
          (order) => [order.id, order.position],
        ),
      ).toEqual([
        [a.id, 0],
        [c.id, 1],
      ]);
      const movedA = await placeOrder(
        actor,
        id,
        a.id,
        m,
        b.id,
        0,
        await planningRevision(id),
        'place-a-before-b',
      );
      expect(movedA.position).toBe(0);
      expect(
        (await listOrders(actor, id, { milestoneId: m })).items.map((order) => [
          order.id,
          order.position,
        ]),
      ).toEqual([
        [a.id, 0],
        [b.id, 1],
      ]);
      const aAtEnd = await placeOrder(
        actor,
        id,
        a.id,
        m,
        null,
        movedA.revision,
        await planningRevision(id),
        'append-a',
      );
      expect(aAtEnd.position).toBe(1);
      expect(
        (await listOrders(actor, id)).items.map((order) => order.id),
      ).toEqual([b.id, a.id, c.id]);
      expect(
        await placeOrder(actor, id, b.id, m, null, 0, firstPlan, 'place-b'),
      ).toEqual(moved);
      const bUnplanned = await placeOrder(
        actor,
        id,
        b.id,
        null,
        c.id,
        moved.revision,
        await planningRevision(id),
        'unplan-b',
      );
      expect(bUnplanned).toMatchObject({
        milestoneId: null,
        position: 0,
        specVersion: 1,
        history: b.history,
      });
      expect(
        (await listOrders(actor, id, { milestoneId: null })).items.map(
          (order) => order.id,
        ),
      ).toEqual([b.id, c.id]);
      expect((await getOrder(actor, id, a.id)).position).toBe(0);
    });

    it('weist veraltete Pläne/Revisionen und ungültige Anker oder Projektzuordnungen ab', async () => {
      const id = await project();
      const foreign = await project('OTHER');
      const a = await createOrder(actor, id, draft('A'), 'a');
      const b = await createOrder(actor, id, draft('B'), 'b');
      const foreignOrder = await createOrder(
        actor,
        foreign,
        draft('Fremd'),
        'foreign',
      );
      const foreignMilestone = await milestone(foreign);
      const m = await milestone(id);
      const plan = await planningRevision(id);
      for (const [target, before, revision, expectedPlan] of [
        [null, a.id, 0, plan],
        [m, b.id, 0, plan],
        [foreignMilestone, null, 0, plan],
        [null, foreignOrder.id, 0, plan],
        ['missing', null, 0, plan],
        [null, null, 1, plan],
        [null, null, 0, plan - 1],
      ] as const) {
        await expect(
          placeOrder(
            actor,
            id,
            a.id,
            target,
            before,
            revision,
            expectedPlan,
            crypto.randomUUID(),
          ),
        ).rejects.toMatchObject({ code: 'conflict' });
      }
      expect(await getOrder(actor, id, a.id)).toEqual(a);
      expect(await planningRevision(id)).toBe(plan);
      await expect(
        placeOrder(actor, id, 'missing', null, null, 0, plan, 'missing'),
      ).rejects.toMatchObject({ code: 'not_found' });
    });

    it('lässt nur einen parallelen Move mit demselben Planstand zu', async () => {
      const id = await project();
      const a = await createOrder(actor, id, draft('A'), 'a');
      const b = await createOrder(actor, id, draft('B'), 'b');
      const m = await milestone(id);
      const plan = await planningRevision(id);
      const outcomes = await Promise.allSettled([
        placeOrder(actor, id, a.id, m, null, 0, plan, 'move-a'),
        placeOrder(actor, id, b.id, m, null, 0, plan, 'move-b'),
      ]);
      expect(
        outcomes.filter((outcome) => outcome.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        outcomes.filter((outcome) => outcome.status === 'rejected'),
      ).toMatchObject([{ reason: { code: 'conflict' } }]);
      expect(
        (await listOrders(actor, id, { milestoneId: m })).items,
      ).toHaveLength(1);
      expect(await planningRevision(id)).toBe(plan + 1);
    });

    it('sperrt geschlossene Quell- und Zielmilestones, auch wenn sie erst vor dem atomaren Guard schließen', async () => {
      const id = await project();
      const a = await createOrder(actor, id, draft('A'), 'a');
      const m = await milestone(id);
      await env.DB.prepare(
        "UPDATE planning_milestones SET state='closed' WHERE id=?",
      )
        .bind(m)
        .run();
      const plan = await planningRevision(id);
      await expect(
        placeOrder(actor, id, a.id, m, null, 0, plan, 'closed-target'),
      ).rejects.toMatchObject({ code: 'conflict' });
      await env.DB.prepare(
        "UPDATE planning_milestones SET state='open' WHERE id=?",
      )
        .bind(m)
        .run();
      const moved = await placeOrder(actor, id, a.id, m, null, 0, plan, 'move');
      await env.DB.prepare(
        "UPDATE planning_milestones SET state='closed' WHERE id=?",
      )
        .bind(m)
        .run();
      await expect(
        placeOrder(
          actor,
          id,
          a.id,
          null,
          null,
          moved.revision,
          await planningRevision(id),
          'closed-source',
        ),
      ).rejects.toMatchObject({ code: 'conflict' });
      await env.DB.prepare(
        "UPDATE planning_milestones SET state='open' WHERE id=?",
      )
        .bind(m)
        .run();
      const originalBatch = env.DB.batch.bind(env.DB);
      let batches = 0;
      vi.spyOn(env.DB, 'batch').mockImplementation(async (statements) => {
        batches++;
        if (batches === 2)
          await env.DB.prepare(
            "UPDATE planning_milestones SET state='closed' WHERE id=?",
          )
            .bind(m)
            .run();
        return originalBatch(statements);
      });
      await expect(
        placeOrder(
          actor,
          id,
          a.id,
          null,
          null,
          moved.revision,
          await planningRevision(id),
          'close-race',
        ),
      ).rejects.toMatchObject({ code: 'conflict' });
      expect((await getOrder(actor, id, a.id)).milestoneId).toBe(m);
    });

    it.each(['implementing', 'implemented', 'done', 'archived'])(
      'sperrt spätere Quellzustände %s für Planung und Beziehungen',
      async (status) => {
        const id = await project();
        const a = await createOrder(actor, id, draft('A'), 'a');
        const b = await createOrder(actor, id, draft('B'), 'b');
        await env.DB.prepare('UPDATE planning_orders SET status=? WHERE id=?')
          .bind(status, a.id)
          .run();
        await expect(
          placeOrder(
            actor,
            id,
            a.id,
            null,
            b.id,
            0,
            await planningRevision(id),
            'move',
          ),
        ).rejects.toMatchObject({ code: 'conflict' });
        await expect(
          setOrderRelation(actor, id, a.id, b.id, 'related', 0, 'relate'),
        ).rejects.toMatchObject({ code: 'conflict' });
        expect((await getOrder(actor, id, a.id)).relations).toEqual([]);
      },
    );

    it('erlaubt Planung für bereit gestellte Aufträge ohne die gesperrte Spezifikation umzuschreiben', async () => {
      const id = await project();
      const a = await createOrder(actor, id, draft('A'), 'a');
      const b = await createOrder(actor, id, draft('B'), 'b');
      await env.DB.prepare(
        "UPDATE planning_orders SET status='ready' WHERE id=?",
      )
        .bind(a.id)
        .run();
      const moved = await placeOrder(
        actor,
        id,
        a.id,
        null,
        b.id,
        0,
        await planningRevision(id),
        'ready-move',
      );
      const related = await setOrderRelation(
        actor,
        id,
        a.id,
        b.id,
        'related',
        moved.revision,
        'ready-relation',
      );
      expect(related.status).toBe('ready');
      expect(related.history).toEqual(a.history);
      expect(related.specVersion).toBe(1);
    });

    it('speichert gerichtete Beziehungen stabil, erhält ursprüngliche Replay-Antworten und entfernt nur bestehende Kanten', async () => {
      const id = await project();
      const a = await createOrder(actor, id, draft('A'), 'a');
      const b = await createOrder(actor, id, draft('B'), 'b');
      const c = await createOrder(actor, id, draft('C'), 'c');
      const first = await setOrderRelation(
        actor,
        id,
        a.id,
        b.id,
        'related',
        0,
        'related',
      );
      expect(first.relations).toEqual([{ targetId: b.id, type: 'related' }]);
      expect((await getOrder(actor, id, b.id)).relations).toEqual([]);
      const second = await setOrderRelation(
        actor,
        id,
        a.id,
        c.id,
        'depends_on',
        first.revision,
        'dependency',
      );
      const third = await setOrderRelation(
        actor,
        id,
        a.id,
        b.id,
        'originated_from',
        second.revision,
        'origin',
      );
      const fourth = await setOrderRelation(
        actor,
        id,
        a.id,
        b.id,
        'replaces',
        third.revision,
        'replace',
      );
      expect(fourth.relations).toEqual([
        { targetId: c.id, type: 'depends_on' },
        { targetId: b.id, type: 'originated_from' },
        { targetId: b.id, type: 'related' },
        { targetId: b.id, type: 'replaces' },
      ]);
      expect(fourth.history).toEqual(a.history);
      expect(
        await setOrderRelation(actor, id, a.id, b.id, 'related', 0, 'related'),
      ).toEqual(first);
      await expect(
        setOrderRelation(
          actor,
          id,
          a.id,
          b.id,
          'related',
          fourth.revision,
          'duplicate',
        ),
      ).rejects.toMatchObject({ code: 'conflict' });
      const removed = await removeOrderRelation(
        actor,
        id,
        a.id,
        b.id,
        'related',
        fourth.revision,
        'remove',
      );
      expect(removed.relations).toHaveLength(3);
      expect(
        await removeOrderRelation(
          actor,
          id,
          a.id,
          b.id,
          'related',
          fourth.revision,
          'remove',
        ),
      ).toEqual(removed);
      await expect(
        removeOrderRelation(
          actor,
          id,
          a.id,
          b.id,
          'related',
          removed.revision,
          'missing-edge',
        ),
      ).rejects.toMatchObject({ code: 'not_found' });
      expect(
        await setOrderRelation(actor, id, a.id, b.id, 'related', 0, 'related'),
      ).toEqual(first);
      expect(await planningRevision(id)).toBe(8);
    });

    it('weist direkte und transitive Abhängigkeitszyklen ab, lässt andere gerichtete Beziehungskreise zu', async () => {
      const id = await project();
      const a = await createOrder(actor, id, draft('A'), 'a');
      const b = await createOrder(actor, id, draft('B'), 'b');
      const c = await createOrder(actor, id, draft('C'), 'c');
      await setOrderRelation(actor, id, a.id, b.id, 'depends_on', 0, 'a-b');
      await setOrderRelation(actor, id, b.id, c.id, 'depends_on', 0, 'b-c');
      await expect(
        setOrderRelation(actor, id, c.id, a.id, 'depends_on', 0, 'c-a'),
      ).rejects.toMatchObject({ code: 'conflict' });
      await expect(
        setOrderRelation(actor, id, b.id, a.id, 'depends_on', 1, 'b-a'),
      ).rejects.toMatchObject({ code: 'conflict' });
      const reverse = await setOrderRelation(
        actor,
        id,
        c.id,
        a.id,
        'related',
        0,
        'related-reverse',
      );
      expect(reverse.relations).toEqual([{ targetId: a.id, type: 'related' }]);
      await expect(
        setOrderRelation(
          actor,
          id,
          c.id,
          c.id,
          'depends_on',
          reverse.revision,
          'self',
        ),
      ).rejects.toMatchObject({ code: 'conflict' });
    });

    it('verhindert Abhängigkeitszyklen auch durch konkurrierende Kanten verschiedener Quellen', async () => {
      const id = await project();
      const a = await createOrder(actor, id, draft('A'), 'a');
      const b = await createOrder(actor, id, draft('B'), 'b');
      const result = await Promise.allSettled([
        setOrderRelation(actor, id, a.id, b.id, 'depends_on', 0, 'a-b'),
        setOrderRelation(actor, id, b.id, a.id, 'depends_on', 0, 'b-a'),
      ]);
      expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(
        1,
      );
      expect(result.filter((item) => item.status === 'rejected')).toMatchObject(
        [{ reason: { code: 'conflict' } }],
      );
      const relations = await env.DB.prepare(
        "SELECT source_id,target_id FROM planning_order_relations WHERE type='depends_on'",
      ).all();
      expect(relations.results).toHaveLength(1);
    });

    it('prüft den rekursiven Graphen erst unter dem Transaktionsguard', async () => {
      const id = await project();
      const a = await createOrder(actor, id, draft('A'), 'a');
      const b = await createOrder(actor, id, draft('B'), 'b');
      const batch = env.DB.batch.bind(env.DB);
      vi.spyOn(env.DB, 'batch').mockImplementationOnce(async (statements) => {
        await env.DB.prepare(
          "INSERT INTO planning_order_relations(source_id,target_id,type) VALUES (?,?,'depends_on')",
        )
          .bind(b.id, a.id)
          .run();
        return batch(statements);
      });
      await expect(
        setOrderRelation(actor, id, a.id, b.id, 'depends_on', 0, 'race'),
      ).rejects.toMatchObject({ code: 'conflict' });
      expect((await getOrder(actor, id, a.id)).relations).toEqual([]);
    });

    it('weist fremde oder fehlende Ziele ab und sperrt geschlossene Beziehungsendpunkte', async () => {
      const id = await project();
      const other = await project('OTHER');
      const a = await createOrder(actor, id, draft('A'), 'a');
      const b = await createOrder(actor, id, draft('B'), 'b');
      const foreign = await createOrder(actor, other, draft('Fremd'), 'f');
      const m = await milestone(id);
      await expect(
        setOrderRelation(actor, id, a.id, foreign.id, 'related', 0, 'foreign'),
      ).rejects.toMatchObject({ code: 'conflict' });
      await expect(
        setOrderRelation(actor, id, a.id, 'missing', 'related', 0, 'missing'),
      ).rejects.toMatchObject({ code: 'not_found' });
      await env.DB.prepare(
        'UPDATE planning_orders SET milestone_id=? WHERE id=?',
      )
        .bind(m, b.id)
        .run();
      await env.DB.prepare(
        "UPDATE planning_milestones SET state='closed' WHERE id=?",
      )
        .bind(m)
        .run();
      await expect(
        setOrderRelation(actor, id, a.id, b.id, 'related', 0, 'closed-target'),
      ).rejects.toMatchObject({ code: 'conflict' });
      await env.DB.prepare(
        'UPDATE planning_orders SET milestone_id=NULL WHERE id=?',
      )
        .bind(b.id)
        .run();
      await env.DB.prepare(
        'UPDATE planning_orders SET milestone_id=? WHERE id=?',
      )
        .bind(m, a.id)
        .run();
      await expect(
        setOrderRelation(actor, id, a.id, b.id, 'related', 0, 'closed-source'),
      ).rejects.toMatchObject({ code: 'conflict' });
    });

    it('rollt Platzierung, Reindexierung, Beziehung und Planrevision bei Belegfehler atomar zurück', async () => {
      const id = await project();
      const a = await createOrder(actor, id, draft('A'), 'a');
      const b = await createOrder(actor, id, draft('B'), 'b');
      await env.DB.prepare(
        "CREATE TRIGGER reject_planning_receipt BEFORE UPDATE OF result_json ON planning_requests BEGIN SELECT RAISE(ABORT, 'PRIVATE'); END",
      ).run();
      const plan = await planningRevision(id);
      await expect(
        placeOrder(actor, id, b.id, null, a.id, 0, plan, 'rollback-move'),
      ).rejects.toMatchObject({ code: 'unavailable' });
      await expect(
        setOrderRelation(
          actor,
          id,
          a.id,
          b.id,
          'related',
          0,
          'rollback-relation',
        ),
      ).rejects.toMatchObject({ code: 'unavailable' });
      expect(await getOrder(actor, id, a.id)).toEqual(a);
      expect(await getOrder(actor, id, b.id)).toEqual(b);
      expect(await planningRevision(id)).toBe(plan);
    });
  });
});
