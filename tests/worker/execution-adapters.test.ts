import { env } from 'cloudflare:workers';
import { afterEach, expect, it } from 'vitest';
import type {
  Approval,
  Evidence,
  EvidenceInput,
  LifecycleSummary,
} from '@/lib/domain/execution';
import type { Order, Project } from '@/lib/domain/planning';
import { dispatchMcp } from '@/lib/mcp/route';
import { GET as lifecycle } from '@/app/api/projects/[projectId]/orders/[orderId]/lifecycle/route';
import { GET as approvals } from '@/app/api/projects/[projectId]/orders/[orderId]/approvals/route';
import { GET as progress } from '@/app/api/projects/[projectId]/orders/[orderId]/progress/route';
import { GET as events } from '@/app/api/projects/[projectId]/orders/[orderId]/events/route';
import { GET as evidence } from '@/app/api/projects/[projectId]/orders/[orderId]/evidence/route';
const headers = {
  'content-type': 'application/json',
  'oai-authenticated-user-id': 'owner',
};
async function rpc(method: string, params: unknown, authenticated = true) {
  const response = await dispatchMcp(
    new Request('https://luufi.test/mcp', {
      method: 'POST',
      headers: authenticated ? headers : { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
    { ...env, LUUFI_ENVIRONMENT: 'production' },
  );
  if (response.status !== 200) return { httpStatus: response.status };
  return (await response.json()) as {
    result: { isError?: boolean; content: { text: string }[] };
    error?: unknown;
  };
}
async function call<T>(name: string, args: unknown): Promise<T> {
  const body = await rpc('tools/call', {
    name,
    arguments: args,
    _meta: { actor: 'spoofed' },
  });
  if (!('result' in body)) throw Error(JSON.stringify(body));
  const value = JSON.parse(body.result.content[0].text);
  if (body.result.isError)
    throw Object.assign(new Error(value.error), { code: value.code });
  return value;
}
const spec = {
  title: 'Nachweise lesen',
  goal: 'Ergebnis verstehen',
  origin: 'Synthetische Chatfreigabe',
  scope: 'Lesen',
  exclusions: 'Keine Mutation',
  criteria: [{ id: 'C1', text: 'Nachweise sind sichtbar' }],
  testStrategy: 'D1 und UI',
  prerequisites: 'Keine weiteren',
  context: { repositoryCommit: 'a'.repeat(40), documentationPolicy: '1.0.0' },
};
afterEach(async () => {
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
it('LUUFI-13/14 verbindet native Nutzerfreigabe, Generationen und echte gemeinsame Browsernachweise', async () => {
  const p = await call<Project>('projects_register', {
    key: 'DEMO',
    name: 'Demo',
    repository: 'example/demo',
    requestKey: 'project',
  });
  const o = await call<Order>('orders_create', {
    projectId: p.id,
    type: 'feature',
    spec,
    requestKey: 'order',
  });
  const entity = { projectId: p.id, id: o.id };
  const read = () => call<LifecycleSummary>('orders_lifecycle', entity);
  await call('orders_mark_ready', {
    ...entity,
    expectedRevision: 0,
    requestKey: 'ready',
  });
  const project = await call<Project>('projects_get', { id: p.id });
  const approval = await call<Approval>('approvals_create', {
    projectId: p.id,
    input: {
      mode: 'selection',
      orderIds: [o.id],
      confirmationReference: 'Nutzer bestätigt DEMO-1 v1',
    },
    expectedPlanningRevision: project.planningRevision,
    requestKey: 'approve',
  });
  expect(
    await call('approvals_items', { projectId: p.id, id: approval.id }),
  ).toMatchObject({ items: [{ orderId: o.id, invalidatedAt: null }] });
  let current = await read();
  const start = {
    ...entity,
    input: {
      approvalId: approval.id,
      worker: 'Agent A',
      branch: 'feature/demo',
      prerequisiteCheck: 'Keine weiteren Voraussetzungen',
    },
    expectedRevision: current.revision,
    requestKey: 'start',
  };
  const original = await call<LifecycleSummary>('orders_start', start);
  let execution = original.execution!;
  await call('orders_pause', {
    ...entity,
    input: {
      executionId: execution.id,
      generation: 1,
      reason: 'Unterbrochen',
      reference: 'Arbeitsstand erhalten',
    },
    expectedRevision: original.revision,
    requestKey: 'pause',
  });
  current = await read();
  await call('orders_takeover', {
    ...entity,
    input: {
      executionId: execution.id,
      generation: 1,
      reason: 'Explizite Übernahme',
      reference: 'Nutzer setzt fort',
      worker: 'Agent B',
    },
    expectedRevision: current.revision,
    requestKey: 'takeover',
  });
  current = await read();
  execution = current.execution!;
  expect(execution).toMatchObject({
    phase: 'paused',
    generation: 2,
    worker: 'Agent B',
  });
  await expect(
    call('orders_resume', {
      ...entity,
      input: {
        executionId: execution.id,
        generation: 1,
        reason: 'Veraltet',
        reference: 'Alt',
      },
      expectedRevision: current.revision,
      requestKey: 'stale',
    }),
  ).rejects.toMatchObject({ code: 'conflict' });
  await call('orders_resume', {
    ...entity,
    input: {
      executionId: execution.id,
      generation: 2,
      reason: 'Unveränderte Arbeit fortsetzen',
      reference: 'Aktuelle Nutzeraufforderung',
    },
    expectedRevision: current.revision,
    requestKey: 'resume',
  });
  current = await read();
  await call('orders_progress_append', {
    ...entity,
    input: {
      executionId: execution.id,
      generation: 2,
      kind: 'obstacle',
      text: 'CI wartet',
      nextAction: 'CI-Lauf prüfen',
    },
    expectedRevision: current.revision,
    requestKey: 'progress',
  });
  expect(await call('orders_start', start)).toEqual(original);
  const input: EvidenceInput = {
    executionId: execution.id,
    generation: 2,
    outcome: 'success',
    commitSha: 'b'.repeat(40),
    summary: 'Kriterien geprüft',
    criteria: [{ id: 'C1', result: 'pass', reference: 'Gezielter D1-Test' }],
    documentationReference: 'docs/features/test.md',
    observation: null,
  };
  current = await read();
  const validation = await call<Evidence>('orders_validation_record', {
    ...entity,
    input,
    expectedRevision: current.revision,
    requestKey: 'validation',
  });
  const observation = {
    repository: 'example/demo',
    branch: 'feature/demo',
    remoteRef: 'refs/heads/feature/demo',
    headSha: 'b'.repeat(40),
    commitSha: 'b'.repeat(40),
    observedAt: new Date().toISOString(),
    source: 'codex-local-git' as const,
    commitSubject: 'feat(DEMO-1): Nachweise lesen',
    parentShas: ['a'.repeat(40)],
    ancestorOfHead: true,
    pushed: true,
    pr: null,
    ci: [],
  };
  current = await read();
  const implementation = await call<Evidence>('orders_implementation_record', {
    ...entity,
    input: { ...input, validationId: validation.id, observation },
    expectedRevision: current.revision,
    requestKey: 'implementation',
  });
  expect(implementation.supersedesId).toBeNull();
  current = await read();
  await call('orders_integration_record', {
    ...entity,
    input: {
      ...input,
      validationId: validation.id,
      unavailableBuildReason: 'Bereitstellung folgt später',
      observation: {
        ...observation,
        branch: 'develop',
        remoteRef: 'refs/heads/develop',
        headSha: 'c'.repeat(40),
        pr: {
          url: 'https://github.com/example/demo/pull/1',
          baseBranch: 'develop',
          headSha: 'b'.repeat(40),
          merged: true,
          mergeSha: 'c'.repeat(40),
          normalMerge: true,
        },
        ci: [
          {
            url: 'https://github.com/example/demo/actions/runs/1',
            name: 'verify',
            headSha: 'b'.repeat(40),
            conclusion: 'success',
          },
        ],
      },
    },
    expectedRevision: current.revision,
    requestKey: 'integration',
  });
  expect(await read()).toMatchObject({
    execution: null,
    currentImplementationId: implementation.id,
    integrationId: expect.any(String),
  });
  expect(await call('orders_get', entity)).toMatchObject({ status: 'done' });
  const ctx = { params: Promise.resolve({ projectId: p.id, orderId: o.id }) };
  for (const route of [lifecycle, approvals, progress, events, evidence]) {
    const response = await route(
      new Request('https://luufi.test/api/projects/x/orders/y', { headers }),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(
      (
        await route(
          new Request('https://luufi.test/api/projects/x/orders/y'),
          ctx,
        )
      ).status,
    ).toBe(401);
  }
  expect(await call('orders_approvals', entity)).toMatchObject({
    items: [{ scope: { invalidatedAt: null }, valid: true }],
  });
  expect(await call('orders_progress', entity)).toMatchObject({
    items: [{ kind: 'obstacle', nextAction: 'CI-Lauf prüfen' }],
  });
  expect(await call('orders_evidence', entity)).toMatchObject({
    items: [
      { kind: 'validation' },
      { kind: 'implementation' },
      { kind: 'integration' },
    ],
  });
  expect(await call('orders_events', entity)).toMatchObject({
    items: expect.any(Array),
  });
});
it('LUUFI-13/14 hält ungültige native Argumente strukturiert und verwendet keine Metadatenidentität', async () => {
  for (const [name, args] of [
    [
      'orders_start',
      {
        projectId: 'p',
        id: 'o',
        input: {
          approvalId: 'a',
          worker: 'agent',
          branch: 'feature/demo',
          prerequisiteCheck: 'ok',
        },
        expectedRevision: 0,
        requestKey: 'key',
        actor: 'spoofed',
      },
    ],
    [
      'orders_takeover',
      {
        projectId: 'p',
        id: 'o',
        input: {
          executionId: 'e',
          generation: 0,
          reason: 'x',
          reference: 'r',
          worker: 'a',
        },
        expectedRevision: 0,
        requestKey: 'key',
      },
    ],
    [
      'orders_integration_record',
      {
        projectId: 'p',
        id: 'o',
        input: { outcome: 'success' },
        expectedRevision: 0,
        requestKey: 'key',
      },
    ],
    [
      'milestones_close',
      {
        projectId: 'p',
        id: 'm',
        input: { confirmEmpty: 'true' },
        expectedRevision: 0,
        requestKey: 'key',
      },
    ],
  ] as const)
    await expect(call(name, args)).rejects.toMatchObject({
      code: 'validation',
    });
  expect(
    await rpc(
      'tools/call',
      {
        name: 'orders_lifecycle',
        arguments: { projectId: 'p', id: 'o' },
        _meta: { actor: 'owner' },
      },
      false,
    ),
  ).toEqual({ httpStatus: 401 });
});
