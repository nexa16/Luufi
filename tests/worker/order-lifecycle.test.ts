import { env } from 'cloudflare:workers';
import { afterEach, expect, it, vi } from 'vitest';
import { createOrder, getOrder, placeOrder } from '@/lib/services/orders';
import { registerProject, getProject } from '@/lib/services/projects';
import { createMilestone } from '@/lib/services/milestones';
import {
  archiveOrder,
  closeMilestone,
  getOrderLifecycle,
  listApprovalItems,
  listLifecycleEvents,
  listOrderApprovals,
  markOrderReady,
  recordApproval,
  returnOrderToDraft,
  revokeApproval,
} from '@/lib/services/order-lifecycle';
import type { OrderSpec } from '@/lib/domain/planning';
import { startExecution } from '@/lib/services/order-execution';
const actor = 'synthetic-owner',
  key = () => crypto.randomUUID();
const decision = {
  reason: 'Bewusst neu planen',
  reference: 'chat:konkrete-nutzerentscheidung',
};
const spec: OrderSpec = {
  title: 'Auftrag',
  goal: 'Ziel',
  origin: 'Chat',
  problem: 'Problem',
  scope: 'Umfang',
  exclusions: 'Keine weiteren Funktionen',
  flows: 'Ablauf',
  criteria: [{ id: 'AC-1', text: 'Ergebnis beobachtbar' }],
  testStrategy: 'D1-Verhaltenstest',
  prerequisites: 'Keine weiteren Voraussetzungen',
  documentation: 'Featurebeschreibung',
  context: { repositoryCommit: 'a'.repeat(40), documentationPolicy: '1.0.0' },
  sources: [],
};
const project = async () =>
  (
    await registerProject(
      actor,
      {
        key: `P${key().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
        name: 'Test',
        repository: 'example/test',
      },
      key(),
    )
  ).id;
const order = async (p: string, content = spec) =>
  (await createOrder(actor, p, { type: 'feature', spec: content }, key())).id;
const ready = async (p: string, id: string) =>
  markOrderReady(
    actor,
    p,
    id,
    (await getOrderLifecycle(actor, p, id)).revision,
    key(),
  );
const approve = async (p: string, ids: string[], requestKey = key()) =>
  recordApproval(
    actor,
    p,
    {
      mode: 'selection',
      orderIds: ids,
      confirmationReference: 'chat:IDs Titel und konkrete Fassungen bestätigt',
    },
    (await getProject(actor, p)).planningRevision,
    requestKey,
  );
afterEach(async () => {
  vi.restoreAllMocks();
  await env.DB.prepare('DROP TRIGGER IF EXISTS fail_lifecycle').run();
  await env.DB.batch(
    [
      'order_evidence',
      'order_progress',
      'order_lifecycle_events',
      'order_executions',
      'order_approval_items',
      'order_approvals',
      'planning_order_relations',
      'planning_order_versions',
      'planning_orders',
      'planning_milestones',
      'planning_requests',
      'planning_projects',
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  );
});
it('stellt bereit, ohne Freigabe oder Ausführung zu erfinden, und bewahrt Fassungen', async () => {
  const p = await project(),
    id = await order(p),
    requestKey = key();
  const result = await markOrderReady(actor, p, id, 0, requestKey);
  expect(result).toMatchObject({
    orderId: id,
    revision: 1,
    lifecycleRevision: 1,
    approval: null,
    execution: null,
  });
  expect(await getOrder(actor, p, id)).toMatchObject({
    status: 'ready',
    specVersion: 1,
    history: [{ version: 1, spec }],
  });
  expect((await listLifecycleEvents(actor, p, id)).items).toMatchObject([
    {
      previousStatus: 'draft',
      nextStatus: 'ready',
      details: { action: 'ready' },
    },
  ]);
  expect(await markOrderReady(actor, p, id, 0, requestKey)).toEqual(result);
  await expect(markOrderReady(actor, p, id, 1, key())).rejects.toMatchObject({
    code: 'conflict',
  });
});
it.each(['scope', 'exclusions', 'testStrategy', 'prerequisites'] as const)(
  'verweigert bereit ohne %s',
  async (field) => {
    const p = await project(),
      id = await order(p, { ...spec, [field]: ' ' });
    await expect(ready(p, id)).rejects.toMatchObject({ code: 'validation' });
    expect((await getOrder(actor, p, id)).status).toBe('draft');
  },
);
it('verlangt Kriterien und konkreten Repository-/Richtlinienkontext', async () => {
  const p = await project();
  for (const content of [
    { ...spec, criteria: [] },
    { ...spec, context: { ...spec.context, repositoryCommit: '' } },
    { ...spec, context: { ...spec.context, documentationPolicy: '' } },
  ]) {
    const id = await order(p, content);
    await expect(ready(p, id)).rejects.toMatchObject({ code: 'validation' });
  }
});
it('friert konkrete Auswahl ein, liefert paginierte Scopeitems und entwertet Rückgabe', async () => {
  const p = await project(),
    a = await order(p),
    b = await order(p);
  await ready(p, a);
  await ready(p, b);
  const requestKey = key(),
    plan = (await getProject(actor, p)).planningRevision,
    input = {
      mode: 'selection' as const,
      orderIds: [b, a, a],
      confirmationReference: 'chat:Auswahl v1',
    };
  const approval = await recordApproval(actor, p, input, plan, requestKey);
  expect(approval).toMatchObject({
    mode: 'selection',
    itemCount: 2,
    revision: 0,
    revokedAt: null,
  });
  const first = await listApprovalItems(actor, p, approval.id, { limit: 1 });
  expect(first.nextCursor).toEqual(expect.any(String));
  const second = await listApprovalItems(actor, p, approval.id, {
    limit: 1,
    cursor: first.nextCursor,
  });
  expect(second.nextCursor).toBeNull();
  expect([...first.items, ...second.items].map((item) => item.orderId)).toEqual(
    [a, b].sort(),
  );
  expect(first.items[0]).toMatchObject({
    specVersion: 1,
    title: 'Auftrag',
    dependencyIds: [],
    repository: 'example/test',
    integrationBranch: 'develop',
    invalidatedAt: null,
  });
  expect((await listOrderApprovals(actor, p, a)).items).toMatchObject([
    { id: approval.id, valid: true, reason: '' },
  ]);
  const after = await returnOrderToDraft(
    actor,
    p,
    a,
    decision,
    (await getOrderLifecycle(actor, p, a)).revision,
    key(),
  );
  expect(after.approval).toMatchObject({
    id: approval.id,
    valid: false,
    reason: decision.reason,
  });
  expect((await getOrder(actor, p, a)).status).toBe('draft');
  expect((await listOrderApprovals(actor, p, b)).items[0].valid).toBe(true);
  expect(await recordApproval(actor, p, input, plan, requestKey)).toEqual(
    approval,
  );
  await expect(
    listApprovalItems(actor, p, approval.id, { cursor: first.nextCursor }),
  ).rejects.toMatchObject({ code: 'conflict' });
});
it('liest Freigabegültigkeit aus Repository und wirksamen Abhängigkeiten', async () => {
  const p = await project(),
    a = await order(p),
    b = await order(p);
  await ready(p, a);
  await approve(p, [a]);
  await env.DB.prepare(
    "INSERT INTO planning_order_relations(source_id,target_id,type) VALUES(?,?,'depends_on')",
  )
    .bind(a, b)
    .run();
  expect((await getOrderLifecycle(actor, p, a)).approval?.valid).toBe(false);
  await env.DB.prepare('DELETE FROM planning_order_relations WHERE source_id=?')
    .bind(a)
    .run();
  await env.DB.prepare(
    "UPDATE planning_projects SET repository='example/changed',revision=revision+1 WHERE id=?",
  )
    .bind(p)
    .run();
  expect((await listOrderApprovals(actor, p, a)).items[0].valid).toBe(false);
});
it('friert alle 51 Milestonemitglieder ein und nimmt spätere Mitglieder nicht auf', async () => {
  const p = await project(),
    m = await createMilestone(actor, p, { title: 'Großer Umfang' }, key()),
    ids: string[] = [];
  for (let n = 0; n < 51; n++) {
    const id = await order(p);
    ids.push(id);
    await env.DB.prepare(
      "UPDATE planning_orders SET status='ready',milestone_id=?,position=? WHERE id=?",
    )
      .bind(m.id, n, id)
      .run();
  }
  const approval = await recordApproval(
    actor,
    p,
    {
      mode: 'milestone',
      milestoneId: m.id,
      confirmationReference: 'chat:vollständiger Milestone',
    },
    (await getProject(actor, p)).planningRevision,
    key(),
  );
  expect(approval.itemCount).toBe(51);
  const page = await listApprovalItems(actor, p, approval.id, { limit: 50 }),
    last = await listApprovalItems(actor, p, approval.id, {
      limit: 50,
      cursor: page.nextCursor,
    });
  expect(page.items.length + last.items.length).toBe(51);
  const extra = await order(p);
  await env.DB.prepare(
    "UPDATE planning_orders SET status='ready',milestone_id=? WHERE id=?",
  )
    .bind(m.id, extra)
    .run();
  expect((await listOrderApprovals(actor, p, extra)).items).toEqual([]);
});
it('schneidet unbereite Milestonemitglieder nicht still ab', async () => {
  const p = await project(),
    m = await createMilestone(actor, p, { title: 'Abschnitt' }, key()),
    a = await order(p),
    b = await order(p);
  await env.DB.prepare(
    'UPDATE planning_orders SET milestone_id=? WHERE id IN (?,?)',
  )
    .bind(m.id, a, b)
    .run();
  await ready(p, a);
  await expect(
    recordApproval(
      actor,
      p,
      {
        mode: 'milestone',
        milestoneId: m.id,
        confirmationReference: 'chat:Milestone',
      },
      (await getProject(actor, p)).planningRevision,
      key(),
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect((await listOrderApprovals(actor, p, a)).items).toEqual([]);
  expect((await approve(p, [a])).itemCount).toBe(1);
});
it('prüft Auswahl und Planrevision atomar, auch wenn sich der Scope vor dem Batch ändert', async () => {
  const p = await project(),
    a = await order(p);
  await ready(p, a);
  const plan = (await getProject(actor, p)).planningRevision,
    batch = env.DB.batch.bind(env.DB);
  vi.spyOn(env.DB, 'batch').mockImplementationOnce(async (statements) => {
    await env.DB.prepare(
      'UPDATE planning_projects SET planning_revision=planning_revision+1 WHERE id=?',
    )
      .bind(p)
      .run();
    return batch(statements);
  });
  await expect(
    recordApproval(
      actor,
      p,
      {
        mode: 'selection',
        orderIds: [a],
        confirmationReference: 'chat:genaue Auswahl',
      },
      plan,
      key(),
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect((await listOrderApprovals(actor, p, a)).items).toEqual([]);
});
it('widerruft ohne Historieverlust und bindet Replay an Inhalt und Actor', async () => {
  const p = await project(),
    a = await order(p);
  await ready(p, a);
  const approval = await approve(p, [a]),
    requestKey = key();
  const result = await revokeApproval(
    actor,
    p,
    approval.id,
    decision,
    0,
    requestKey,
  );
  expect(result).toMatchObject({ revision: 1, revokedAt: expect.any(String) });
  expect((await listOrderApprovals(actor, p, a)).items[0]).toMatchObject({
    valid: false,
    reason: 'Freigabe widerrufen',
  });
  expect(
    await revokeApproval(actor, p, approval.id, decision, 0, requestKey),
  ).toEqual(result);
  await expect(
    revokeApproval('other', p, approval.id, decision, 0, requestKey),
  ).rejects.toMatchObject({ code: 'conflict' });
  await expect(
    revokeApproval(
      actor,
      p,
      approval.id,
      { ...decision, reason: 'Anders' },
      0,
      requestKey,
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
});

it('entwertet ersetzte Freigaben nur für den neuen Scope und aktiviert sie nach Widerruf nicht erneut', async () => {
  const p = await project(),
    a = await order(p),
    b = await order(p);
  await ready(p, a);
  await ready(p, b);
  const older = await approve(p, [a, b]),
    newer = await approve(p, [a]);
  await revokeApproval(actor, p, newer.id, decision, 0, key());
  await expect(
    startExecution(
      actor,
      p,
      a,
      {
        approvalId: older.id,
        worker: 'agent',
        branch: 'codex/runde',
        prerequisiteCheck: 'Konkret geprüft',
      },
      (await getOrderLifecycle(actor, p, a)).revision,
      key(),
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect(
    (await listOrderApprovals(actor, p, a)).items.find(
      (item) => item.id === older.id,
    ),
  ).toMatchObject({
    valid: false,
    scope: { invalidatedAt: expect.any(String) },
  });
  expect(
    (await listOrderApprovals(actor, p, b)).items.find(
      (item) => item.id === older.id,
    ),
  ).toMatchObject({ valid: true, scope: { invalidatedAt: null } });
  expect(
    (
      await startExecution(
        actor,
        p,
        b,
        {
          approvalId: older.id,
          worker: 'agent',
          branch: 'codex/runde',
          prerequisiteCheck: 'Unveränderte verbleibende Auswahl geprüft',
        },
        (
          await getOrderLifecycle(actor, p, b)
        ).revision,
        key(),
      )
    ).execution?.phase,
  ).toBe('active');
});
it('archiviert begründet und schließt einen nicht leeren vollständig archivierten Milestone', async () => {
  const p = await project(),
    m = await createMilestone(actor, p, { title: 'Nicht leer' }, key()),
    a = await order(p),
    b = await order(p);
  await env.DB.prepare(
    'UPDATE planning_orders SET milestone_id=? WHERE id IN (?,?)',
  )
    .bind(m.id, a, b)
    .run();
  await archiveOrder(actor, p, a, decision, 0, key());
  expect((await getOrder(actor, p, a)).status).toBe('archived');
  expect(
    await env.DB.prepare('SELECT state FROM planning_milestones WHERE id=?')
      .bind(m.id)
      .first(),
  ).toEqual({ state: 'open' });
  await archiveOrder(actor, p, b, decision, 0, key());
  expect(
    await env.DB.prepare('SELECT state FROM planning_milestones WHERE id=?')
      .bind(m.id)
      .first(),
  ).toEqual({ state: 'closed' });
  const c = await order(p);
  await expect(
    placeOrder(
      actor,
      p,
      c,
      m.id,
      null,
      0,
      (await getProject(actor, p)).planningRevision,
      key(),
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
});
it('schließt leere Milestones ausschließlich mit ausdrücklicher Bestätigung', async () => {
  const p = await project(),
    m = await createMilestone(actor, p, { title: 'Leer' }, key());
  await expect(
    closeMilestone(actor, p, m.id, { confirmEmpty: false }, 0, key()),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect(
    await closeMilestone(actor, p, m.id, { confirmEmpty: true }, 0, key()),
  ).toMatchObject({ state: 'closed', revision: 1 });
});
it('rollt Status, Freigabe und Ereignis bei Receiptfehler vollständig zurück', async () => {
  const p = await project(),
    id = await order(p);
  await env.DB.prepare(
    "CREATE TRIGGER fail_lifecycle BEFORE UPDATE ON planning_requests BEGIN SELECT RAISE(ABORT,'PRIVATE'); END",
  ).run();
  await expect(markOrderReady(actor, p, id, 0, key())).rejects.toMatchObject({
    code: 'unavailable',
  });
  expect((await getOrder(actor, p, id)).status).toBe('draft');
  expect((await listLifecycleEvents(actor, p, id)).items).toEqual([]);
  await env.DB.prepare('DROP TRIGGER fail_lifecycle').run();
  await ready(p, id);
  await env.DB.prepare(
    "CREATE TRIGGER fail_lifecycle BEFORE UPDATE ON planning_requests BEGIN SELECT RAISE(ABORT,'PRIVATE'); END",
  ).run();
  await expect(approve(p, [id])).rejects.toMatchObject({ code: 'unavailable' });
  expect((await listOrderApprovals(actor, p, id)).items).toEqual([]);
});
it('verlangt Identität, Projektzugehörigkeit und begrenzte strikte Eingaben', async () => {
  const p = await project(),
    other = await project(),
    id = await order(p);
  await ready(p, id);
  for (const action of [
    () => getOrderLifecycle('', p, id),
    () => markOrderReady('', p, id, 1, key()),
    () =>
      recordApproval(
        '',
        p,
        { mode: 'selection', orderIds: [id], confirmationReference: 'Chat' },
        0,
        key(),
      ),
  ])
    await expect(action()).rejects.toMatchObject({ code: 'unauthorized' });
  for (const action of [
    () => getOrderLifecycle(actor, other, id),
    () => listOrderApprovals(actor, other, id),
    () => listLifecycleEvents(actor, other, id),
    () => listApprovalItems(actor, p, 'missing'),
  ])
    await expect(action()).rejects.toMatchObject({ code: 'not_found' });
  for (const input of [
    { mode: 'selection', orderIds: [], confirmationReference: 'Chat' },
    {
      mode: 'selection',
      orderIds: Array(51).fill(id),
      confirmationReference: 'Chat',
    },
    { mode: 'selection', orderIds: [id], confirmationReference: ' ' },
    {
      mode: 'milestone',
      orderIds: [id],
      milestoneId: 'm',
      confirmationReference: 'Chat',
    },
    {
      mode: 'selection',
      orderIds: [id],
      confirmationReference: 'Chat',
      actor: 'spoofed',
    },
  ])
    await expect(
      recordApproval(actor, p, input as never, 0, key()),
    ).rejects.toMatchObject({ code: 'validation' });
  await expect(
    archiveOrder(actor, p, id, { reason: '', reference: 'Chat' }, 1, key()),
  ).rejects.toMatchObject({ code: 'validation' });
  await expect(
    listLifecycleEvents(actor, p, id, { cursor: 'invalid' }),
  ).rejects.toMatchObject({ code: 'validation' });
});
