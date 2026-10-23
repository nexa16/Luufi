import { env } from 'cloudflare:workers';
import { afterEach, expect, it, vi } from 'vitest';
import { registerProject, getProject } from '@/lib/services/projects';
import {
  createOrder,
  getOrder,
  setOrderRelation,
  updateDraftOrder,
} from '@/lib/services/orders';
import {
  archiveOrder,
  getOrderLifecycle,
  listLifecycleEvents,
  markOrderReady,
  recordApproval,
  revokeApproval,
} from '@/lib/services/order-lifecycle';
import {
  appendOrderProgress,
  listOrderProgress,
  pauseExecution,
  resumeExecution,
  startExecution,
  stopForReplan,
  takeOverExecution,
} from '@/lib/services/order-execution';
import type { Execution, LifecycleSummary } from '@/lib/domain/execution';
const actor = 'owner',
  key = () => crypto.randomUUID(),
  branch = 'codex/runde';
const spec = {
  title: 'Auftrag',
  goal: 'Ziel',
  origin: 'Chat',
  scope: 'Umfang',
  exclusions: 'Keine Extras',
  criteria: [{ id: 'AC1', text: 'Verhalten' }],
  testStrategy: 'D1',
  prerequisites: 'Geprüft',
  context: { repositoryCommit: 'a'.repeat(40), documentationPolicy: '1.0.0' },
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
const order = async (p: string) =>
  (await createOrder(actor, p, { type: 'feature', spec }, key())).id;
async function approved(p: string, id: string) {
  await markOrderReady(
    actor,
    p,
    id,
    (await getOrderLifecycle(actor, p, id)).revision,
    key(),
  );
  return recordApproval(
    actor,
    p,
    {
      mode: 'selection',
      orderIds: [id],
      confirmationReference: 'chat:konkrete v1',
    },
    (await getProject(actor, p)).planningRevision,
    key(),
  );
}
async function started(p: string, id: string) {
  const approval = await approved(p, id);
  return startExecution(
    actor,
    p,
    id,
    {
      approvalId: approval.id,
      worker: 'agent-a',
      branch,
      prerequisiteCheck: 'Dokumentation und Voraussetzungen geprüft',
    },
    (await getOrderLifecycle(actor, p, id)).revision,
    key(),
  );
}
const control = (summary: LifecycleSummary) => ({
  executionId: summary.execution!.id,
  generation: summary.execution!.generation,
  reason: 'Konkreter Anlass und bisheriger Stand',
  reference: 'chat:Nutzeraufforderung',
});
const progress = (execution: Execution) => ({
  executionId: execution.id,
  generation: execution.generation,
  kind: 'update' as const,
  text: 'Fortschritt',
  nextAction: '',
});
afterEach(async () => {
  vi.restoreAllMocks();
  await env.DB.prepare('DROP TRIGGER IF EXISTS fail_execution').run();
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
it('beginnt nur bereit und ausdrücklich freigegeben, mit genau einem offenen Claim', async () => {
  const p = await project(),
    id = await order(p);
  await expect(
    startExecution(
      actor,
      p,
      id,
      {
        approvalId: 'missing',
        worker: 'a',
        branch,
        prerequisiteCheck: 'Geprüft',
      },
      0,
      key(),
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
  const approval = await approved(p, id),
    revision = (await getOrderLifecycle(actor, p, id)).revision;
  const input = {
    approvalId: approval.id,
    worker: 'agent-a',
    branch,
    prerequisiteCheck: 'Konkret geprüft',
  };
  const results = await Promise.allSettled([
    startExecution(actor, p, id, input, revision, key()),
    startExecution(
      actor,
      p,
      id,
      { ...input, worker: 'agent-b' },
      revision,
      key(),
    ),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((r) => r.status === 'rejected')).toMatchObject({
    reason: { code: 'conflict' },
  });
  expect((await getOrder(actor, p, id)).status).toBe('implementing');
  const summary = await getOrderLifecycle(actor, p, id);
  expect(summary.execution).toMatchObject({
    phase: 'active',
    generation: 1,
    specVersion: 1,
  });
  await expect(
    updateDraftOrder(
      actor,
      p,
      id,
      { type: 'feature', spec },
      summary.revision,
      key(),
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
  await expect(
    archiveOrder(
      actor,
      p,
      id,
      { reason: 'Abbruch', reference: 'chat:Abbruch' },
      summary.revision,
      key(),
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
  await expect(
    revokeApproval(
      actor,
      p,
      approval.id,
      { reason: 'Widerruf', reference: 'chat:Widerruf' },
      0,
      key(),
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
});
it('löst Unterbrechung nicht zeitgesteuert auf und hält bei Übernahme alte Generationen fern', async () => {
  const p = await project(),
    id = await order(p),
    start = await started(p, id);
  const paused = await pauseExecution(
    actor,
    p,
    id,
    control(start),
    start.revision,
    key(),
  );
  expect(paused.execution).toMatchObject({ phase: 'paused', generation: 1 });
  expect((await getOrder(actor, p, id)).status).toBe('implementing');
  await env.DB.prepare(
    "UPDATE order_executions SET created_at='2000-01-01T00:00:00.000Z' WHERE id=?",
  )
    .bind(start.execution!.id)
    .run();
  const over = await takeOverExecution(
    actor,
    p,
    id,
    { ...control(paused), worker: 'agent-neu' },
    paused.revision,
    key(),
  );
  expect(over.execution).toMatchObject({
    worker: 'agent-neu',
    generation: 2,
    phase: 'paused',
  });
  await expect(
    appendOrderProgress(
      actor,
      p,
      id,
      progress(start.execution!),
      over.revision,
      key(),
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
  const resumed = await resumeExecution(
    actor,
    p,
    id,
    control(over),
    over.revision,
    key(),
  );
  expect(resumed.execution).toMatchObject({
    phase: 'active',
    generation: 2,
    worker: 'agent-neu',
  });
  expect(
    (await listLifecycleEvents(actor, p, id)).items.map(
      (e) => e.details.action,
    ),
  ).toEqual(['ready', 'start', 'pause', 'takeover', 'resume']);
});
it('sperrt Resume nach veränderten Freigabevoraussetzungen', async () => {
  const p = await project(),
    id = await order(p),
    start = await started(p, id),
    paused = await pauseExecution(
      actor,
      p,
      id,
      control(start),
      start.revision,
      key(),
    );
  await env.DB.prepare(
    "UPDATE planning_projects SET repository='example/changed' WHERE id=?",
  )
    .bind(p)
    .run();
  await expect(
    resumeExecution(actor, p, id, control(paused), paused.revision, key()),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect((await getOrderLifecycle(actor, p, id)).execution?.phase).toBe(
    'paused',
  );
});
it('stoppt ausdrücklich zur Neuplanung, schließt Claim und entwertet Freigabe', async () => {
  const p = await project(),
    id = await order(p),
    start = await started(p, id),
    requestKey = key();
  const result = await stopForReplan(
    actor,
    p,
    id,
    control(start),
    start.revision,
    requestKey,
  );
  expect(result).toMatchObject({
    execution: null,
    currentImplementationId: null,
    integrationId: null,
    approval: { valid: false },
  });
  expect((await getOrder(actor, p, id)).status).toBe('draft');
  expect(
    await stopForReplan(
      actor,
      p,
      id,
      control(start),
      start.revision,
      requestKey,
    ),
  ).toEqual(result);
  await expect(
    appendOrderProgress(
      actor,
      p,
      id,
      progress(start.execution!),
      result.revision,
      key(),
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
  const edited = await updateDraftOrder(
    actor,
    p,
    id,
    { type: 'feature', spec: { ...spec, title: 'Neue Fassung' } },
    result.revision,
    key(),
  );
  expect(edited.specVersion).toBe(2);
  const restarted = await started(p, id);
  expect(restarted.execution).toMatchObject({ generation: 3, specVersion: 2 });
});
it('erlaubt Stop/Replan auch nach implemented, bewahrt aber alte Belege', async () => {
  const p = await project(),
    id = await order(p),
    start = await started(p, id);
  await env.DB.prepare(
    "UPDATE planning_orders SET status='implemented',current_implementation_id='alter-kandidat' WHERE id=?",
  )
    .bind(id)
    .run();
  const stopped = await stopForReplan(
    actor,
    p,
    id,
    control(start),
    start.revision,
    key(),
  );
  expect(stopped.currentImplementationId).toBeNull();
  expect((await getOrder(actor, p, id)).status).toBe('draft');
});
it('benötigt erledigte oder aktuelle geprüfte gepushte Vorgänger im selben Branch', async () => {
  const p = await project(),
    dep = await order(p),
    id = await order(p),
    depStart = await started(p, dep);
  await setOrderRelation(actor, p, id, dep, 'depends_on', 0, key());
  const approval = await approved(p, id),
    revision = (await getOrderLifecycle(actor, p, id)).revision,
    input = {
      approvalId: approval.id,
      worker: 'a',
      branch,
      prerequisiteCheck: 'Vorgänger konkret geprüft',
    };
  await expect(
    startExecution(actor, p, id, input, revision, key()),
  ).rejects.toMatchObject({ code: 'conflict' });
  const evidenceId = key();
  await env.DB.prepare(
    "INSERT INTO order_evidence(id,order_id,spec_version,kind,outcome,execution_id,generation,payload_json,created_at) VALUES(?,?,1,'implementation','success',?,1,?,?)",
  )
    .bind(
      evidenceId,
      dep,
      depStart.execution!.id,
      JSON.stringify({
        observation: {
          repository: 'example/test',
          branch: 'codex/anderer',
          pushed: true,
          ancestorOfHead: true,
        },
      }),
      new Date().toISOString(),
    )
    .run();
  await env.DB.prepare(
    "UPDATE planning_orders SET status='implemented',current_implementation_id=? WHERE id=?",
  )
    .bind(evidenceId, dep)
    .run();
  await expect(
    startExecution(actor, p, id, input, revision, key()),
  ).rejects.toMatchObject({ code: 'conflict' });
  await env.DB.prepare(
    "UPDATE order_evidence SET payload_json=json_set(payload_json,'$.observation.branch',?) WHERE id=?",
  )
    .bind(branch, evidenceId)
    .run();
  expect(
    (await startExecution(actor, p, id, input, revision, key())).execution
      ?.phase,
  ).toBe('active');
});
it('akzeptiert done als erfüllte Voraussetzung und ignoriert archiviert nicht als erledigt', async () => {
  const p = await project(),
    dep = await order(p),
    id = await order(p);
  await setOrderRelation(actor, p, id, dep, 'depends_on', 0, key());
  const approval = await approved(p, id),
    revision = (await getOrderLifecycle(actor, p, id)).revision,
    input = {
      approvalId: approval.id,
      worker: 'a',
      branch,
      prerequisiteCheck: 'Vorgängerstatus geprüft',
    };
  await env.DB.prepare(
    "UPDATE planning_orders SET status='archived' WHERE id=?",
  )
    .bind(dep)
    .run();
  await expect(
    startExecution(actor, p, id, input, revision, key()),
  ).rejects.toMatchObject({ code: 'conflict' });
  await env.DB.prepare("UPDATE planning_orders SET status='done' WHERE id=?")
    .bind(dep)
    .run();
  expect(
    (await startExecution(actor, p, id, input, revision, key())).execution,
  ).not.toBeNull();
});
it('prüft Claimgeneration und aktuelle Freigabe nochmals im atomaren Guard', async () => {
  const p = await project(),
    id = await order(p),
    start = await started(p, id),
    batch = env.DB.batch.bind(env.DB);
  vi.spyOn(env.DB, 'batch').mockImplementationOnce(async (statements) => {
    await env.DB.prepare(
      'UPDATE order_executions SET generation=generation+1 WHERE id=?',
    )
      .bind(start.execution!.id)
      .run();
    return batch(statements);
  });
  await expect(
    pauseExecution(actor, p, id, control(start), start.revision, key()),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect((await getOrderLifecycle(actor, p, id)).execution?.phase).toBe(
    'active',
  );
});

it('verhindert Start, wenn die Freigabe nach der Vorprüfung widerrufen wird', async () => {
  const p = await project(),
    id = await order(p),
    approval = await approved(p, id),
    revision = (await getOrderLifecycle(actor, p, id)).revision,
    batch = env.DB.batch.bind(env.DB);
  vi.spyOn(env.DB, 'batch').mockImplementationOnce(async (statements) => {
    await env.DB.prepare(
      "UPDATE order_approvals SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),revision=revision+1 WHERE id=?",
    )
      .bind(approval.id)
      .run();
    return batch(statements);
  });
  await expect(
    startExecution(
      actor,
      p,
      id,
      {
        approvalId: approval.id,
        worker: 'a',
        branch,
        prerequisiteCheck: 'Konkret geprüft',
      },
      revision,
      key(),
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect((await getOrderLifecycle(actor, p, id)).execution).toBeNull();
  expect((await getOrder(actor, p, id)).status).toBe('ready');
});
it('verliert keine Notizen durch identisches Replay und paginiert fortschreibungsgebunden', async () => {
  const p = await project(),
    id = await order(p),
    start = await started(p, id),
    requestKey = key(),
    input = progress(start.execution!);
  const results = await Promise.all([
    appendOrderProgress(actor, p, id, input, start.revision, requestKey),
    appendOrderProgress(actor, p, id, input, start.revision, requestKey),
  ]);
  expect(results[0]).toEqual(results[1]);
  const next = await getOrderLifecycle(actor, p, id);
  await appendOrderProgress(
    actor,
    p,
    id,
    {
      ...input,
      kind: 'obstacle',
      text: 'Testumgebung fehlt',
      nextAction: 'D1-Verbindung wiederherstellen',
    },
    next.revision,
    key(),
  );
  const first = await listOrderProgress(actor, p, id, { limit: 1 });
  expect(first.items).toHaveLength(1);
  expect(first.nextCursor).toEqual(expect.any(String));
  expect(
    (
      await listOrderProgress(actor, p, id, {
        limit: 1,
        cursor: first.nextCursor,
      })
    ).items,
  ).toMatchObject([
    { kind: 'obstacle', nextAction: 'D1-Verbindung wiederherstellen' },
  ]);
  const current = await getOrderLifecycle(actor, p, id);
  await appendOrderProgress(actor, p, id, input, current.revision, key());
  await expect(
    listOrderProgress(actor, p, id, { cursor: first.nextCursor }),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect((await getOrder(actor, p, id)).specVersion).toBe(1);
  await expect(
    appendOrderProgress(
      actor,
      p,
      id,
      { ...input, text: 'Andere Notiz' },
      start.revision,
      requestKey,
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
});
it.each(['start', 'progress', 'stop'] as const)(
  'rollt %s und Ereignisse bei Receiptfehler zurück',
  async (operation) => {
    const p = await project(),
      id = await order(p),
      approval = await approved(p, id);
    const start =
      operation === 'start'
        ? null
        : await startExecution(
            actor,
            p,
            id,
            {
              approvalId: approval.id,
              worker: 'a',
              branch,
              prerequisiteCheck: 'Geprüft',
            },
            (await getOrderLifecycle(actor, p, id)).revision,
            key(),
          );
    const before = await getOrderLifecycle(actor, p, id),
      events = (await listLifecycleEvents(actor, p, id)).items;
    await env.DB.prepare(
      "CREATE TRIGGER fail_execution BEFORE UPDATE ON planning_requests BEGIN SELECT RAISE(ABORT,'PRIVATE'); END",
    ).run();
    const action =
      operation === 'start'
        ? startExecution(
            actor,
            p,
            id,
            {
              approvalId: approval.id,
              worker: 'a',
              branch,
              prerequisiteCheck: 'Geprüft',
            },
            before.revision,
            key(),
          )
        : operation === 'stop'
          ? stopForReplan(actor, p, id, control(start!), before.revision, key())
          : appendOrderProgress(
              actor,
              p,
              id,
              progress(start!.execution!),
              before.revision,
              key(),
            );
    await expect(action).rejects.toMatchObject({ code: 'unavailable' });
    expect(await getOrderLifecycle(actor, p, id)).toEqual(before);
    expect((await listLifecycleEvents(actor, p, id)).items).toEqual(events);
    expect((await listOrderProgress(actor, p, id)).items).toEqual([]);
  },
);
it('schützt done, Projektgrenzen, Identität und strikte Nutzereingaben', async () => {
  const p = await project(),
    other = await project(),
    id = await order(p),
    start = await started(p, id),
    input = control(start);
  await expect(
    pauseExecution('', p, id, input, start.revision, key()),
  ).rejects.toMatchObject({ code: 'unauthorized' });
  await expect(listOrderProgress(actor, other, id)).rejects.toMatchObject({
    code: 'not_found',
  });
  for (const changed of [
    { ...input, reference: '' },
    { ...input, generation: 0 },
    { ...input, actor: 'spoofed' },
  ])
    await expect(
      pauseExecution(actor, p, id, changed as never, start.revision, key()),
    ).rejects.toMatchObject({ code: 'validation' });
  await expect(
    appendOrderProgress(
      actor,
      p,
      id,
      { ...progress(start.execution!), kind: 'obstacle', nextAction: '' },
      start.revision,
      key(),
    ),
  ).rejects.toMatchObject({ code: 'validation' });
  await env.DB.prepare("UPDATE planning_orders SET status='done' WHERE id=?")
    .bind(id)
    .run();
  for (const action of [pauseExecution, resumeExecution, stopForReplan])
    await expect(
      action(actor, p, id, input, start.revision, key()),
    ).rejects.toMatchObject({ code: 'conflict' });
  await expect(
    takeOverExecution(
      actor,
      p,
      id,
      { ...input, worker: 'b' },
      start.revision,
      key(),
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
});
