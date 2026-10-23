import { env } from 'cloudflare:workers';
import { afterEach, expect, it, vi } from 'vitest';
import {
  registerProject,
  updateProject,
  getProject,
} from '@/lib/services/projects';
import {
  createOrder,
  setOrderRelation,
  removeOrderRelation,
  placeOrder,
  getOrder,
} from '@/lib/services/orders';
import { createMilestone } from '@/lib/services/milestones';
import type { Order } from '@/lib/domain/planning';
async function setup() {
  const project = await registerProject(
    'owner',
    { key: 'DEMO', name: 'Demo', repository: 'example/demo' },
    crypto.randomUUID(),
  );
  const order = await createOrder(
    'owner',
    project.id,
    {
      type: 'feature',
      spec: {
        title: 'Eingefrorener Umfang',
        goal: 'Ziel',
        origin: 'Synthetische Prüfung',
      },
    },
    crypto.randomUUID(),
  );
  return { project, order };
}
async function approval(order: Order) {
  const now = new Date().toISOString(),
    id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("UPDATE planning_orders SET status='ready' WHERE id=?").bind(
      order.id,
    ),
    env.DB.prepare(
      "INSERT INTO order_approvals(id,project_id,mode,confirmation_reference,created_at) VALUES (?,?,'selection','Synthetische Nutzerfreigabe',?)",
    ).bind(id, order.projectId, now),
    env.DB.prepare(
      "INSERT INTO order_approval_items(approval_id,order_id,spec_version,title,dependency_ids_json,repository,integration_branch) VALUES (?,?,1,?,'[]','example/demo','develop')",
    ).bind(id, order.id, order.spec.title),
  ]);
  return id;
}
async function claim(order: Order, approvalId: string) {
  await env.DB.prepare(
    "INSERT INTO order_executions(id,project_id,order_id,spec_version,approval_id,worker,branch,generation,phase,created_at,updated_at) VALUES (?,?,?,1,?,'test-worker','feature/demo',1,'active','2026-10-23T00:00:00Z','2026-10-23T00:00:00Z')",
  )
    .bind(crypto.randomUUID(), order.projectId, order.id, approvalId)
    .run();
}
const invalidation = (id: string) =>
  env.DB.prepare(
    'SELECT invalidated_at,invalidated_reason FROM order_approval_items WHERE order_id=?',
  )
    .bind(id)
    .first();
afterEach(async () => {
  vi.restoreAllMocks();
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
    ].map((t) => env.DB.prepare('DELETE FROM ' + t)),
  );
});
it('LUUFI-13 entwertet geänderte Voraussetzungen dauerhaft, auch nach Rückkehr zum alten Graphen', async () => {
  const { project, order } = await setup();
  await approval(order);
  const predecessor = await createOrder(
    'owner',
    project.id,
    {
      type: 'technical',
      spec: { title: 'Vorgänger', goal: 'Vorarbeit', origin: 'Test' },
    },
    'predecessor',
  );
  const linked = await setOrderRelation(
    'owner',
    project.id,
    order.id,
    predecessor.id,
    'depends_on',
    0,
    'depends',
  );
  expect(await invalidation(order.id)).toMatchObject({
    invalidated_at: expect.any(String),
    invalidated_reason: 'Voraussetzungen verändert',
  });
  await removeOrderRelation(
    'owner',
    project.id,
    order.id,
    predecessor.id,
    'depends_on',
    linked.revision,
    'remove',
  );
  expect((await getOrder('owner', project.id, order.id)).relations).toEqual([]);
  expect(await invalidation(order.id)).toMatchObject({
    invalidated_at: expect.any(String),
  });
});
it('LUUFI-13 entwertet Repositoryänderungen dauerhaft und erlaubt reine Namenspflege ohne Entwertung', async () => {
  const { project, order } = await setup();
  await approval(order);
  const renamed = await updateProject(
    'owner',
    project.id,
    { name: 'Neuer Name', repository: 'example/demo' },
    0,
    'rename',
  );
  expect(await invalidation(order.id)).toMatchObject({ invalidated_at: null });
  const changed = await updateProject(
    'owner',
    project.id,
    { name: renamed.name, repository: 'example/other' },
    renamed.revision,
    'repo',
  );
  expect(await invalidation(order.id)).toMatchObject({
    invalidated_at: expect.any(String),
  });
  await updateProject(
    'owner',
    project.id,
    { name: changed.name, repository: 'example/demo' },
    changed.revision,
    'back',
  );
  expect(await invalidation(order.id)).toMatchObject({
    invalidated_at: expect.any(String),
  });
});
it('LUUFI-13 schützt den Ausführungskontext auch gegen einen erst im D1-Guard entstandenen Claim', async () => {
  const { project, order } = await setup(),
    a = await approval(order);
  const original = env.DB.batch.bind(env.DB);
  let intercepted = false;
  vi.spyOn(env.DB, 'batch').mockImplementation(async (statements) => {
    if (!intercepted) {
      intercepted = true;
      await claim(order, a);
    }
    return original(statements);
  });
  await expect(
    updateProject(
      'owner',
      project.id,
      { name: 'Demo', repository: 'example/other' },
      0,
      'race',
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect((await getProject('owner', project.id)).repository).toBe(
    'example/demo',
  );
  expect(await invalidation(order.id)).toMatchObject({ invalidated_at: null });
  expect(
    await updateProject(
      'owner',
      project.id,
      { name: 'Nur Name', repository: 'example/demo' },
      0,
      'name',
    ),
  ).toMatchObject({ name: 'Nur Name' });
});
it('LUUFI-13 erlaubt erfüllte Vorgänger in geschlossenen Milestones ohne ihren Stand zu ändern', async () => {
  const { project, order } = await setup();
  const predecessor = await createOrder(
    'owner',
    project.id,
    {
      type: 'technical',
      spec: { title: 'Erledigt', goal: 'Vorarbeit', origin: 'Test' },
    },
    'done',
  );
  const milestone = await createMilestone(
    'owner',
    project.id,
    { title: 'Abgeschlossen' },
    'milestone',
  );
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE planning_orders SET status='done',milestone_id=? WHERE id=?",
    ).bind(milestone.id, predecessor.id),
    env.DB.prepare(
      "UPDATE planning_milestones SET state='closed' WHERE id=?",
    ).bind(milestone.id),
  ]);
  expect(
    await setOrderRelation(
      'owner',
      project.id,
      order.id,
      predecessor.id,
      'depends_on',
      0,
      'link-done',
    ),
  ).toMatchObject({
    relations: [{ targetId: predecessor.id, type: 'depends_on' }],
  });
  expect(await getOrder('owner', project.id, predecessor.id)).toMatchObject({
    status: 'done',
    revision: 0,
  });
});
it('LUUFI-13 schließt einen nicht leeren erfüllten Milestone atomar nach einer Umplanung', async () => {
  const { project, order } = await setup();
  const done = await createOrder(
    'owner',
    project.id,
    {
      type: 'technical',
      spec: { title: 'Fertig', goal: 'Vorarbeit', origin: 'Test' },
    },
    'done',
  );
  const milestone = await createMilestone(
    'owner',
    project.id,
    { title: 'Ziel' },
    'milestone',
  );
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE planning_orders SET milestone_id=? WHERE id IN (?,?)',
    ).bind(milestone.id, order.id, done.id),
    env.DB.prepare("UPDATE planning_orders SET status='done' WHERE id=?").bind(
      done.id,
    ),
  ]);
  const current = await getProject('owner', project.id);
  await placeOrder(
    'owner',
    project.id,
    order.id,
    null,
    null,
    0,
    current.planningRevision,
    'out',
  );
  expect(
    await env.DB.prepare('SELECT state FROM planning_milestones WHERE id=?')
      .bind(milestone.id)
      .first(),
  ).toEqual({ state: 'closed' });
});
