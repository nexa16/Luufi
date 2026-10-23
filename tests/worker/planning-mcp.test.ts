import { env } from 'cloudflare:workers';
import { afterEach, expect, it } from 'vitest';
import { registerProject } from '@/lib/services/projects';
import { dispatchMcp } from '@/lib/mcp/route';
import { GET as milestones } from '@/app/api/projects/[projectId]/milestones/route';
import { GET as orders } from '@/app/api/projects/[projectId]/orders/route';
import { GET as orderDetail } from '@/app/api/projects/[projectId]/orders/[orderId]/route';

const headers = {
  'content-type': 'application/json',
  'oai-authenticated-user-id': 'owner',
};
async function call<T = Record<string, unknown>>(
  name: string,
  args: unknown,
  authenticated = true,
): Promise<T> {
  const response = await dispatchMcp(
    new Request('https://luufi.test/mcp', {
      method: 'POST',
      headers: authenticated ? headers : { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args, _meta: { actor: 'spoofed' } },
      }),
    }),
    { ...env, LUUFI_ENVIRONMENT: 'preview' },
  );
  if (response.status !== 200) return { httpStatus: response.status } as T;
  const body = (await response.json()) as {
    result: { isError?: boolean; content: { text: string }[] };
  };
  const content = JSON.parse(body.result.content[0].text);
  if (body.result.isError) return { ...content, isError: true };
  return content;
}
const project = () =>
  registerProject(
    'owner',
    { key: 'DEMO', name: 'Beispiel', repository: 'example/demo' },
    crypto.randomUUID(),
  );
const request = (url: string) =>
  new Request(`https://luufi.test${url}`, { headers });
afterEach(async () => {
  await env.DB.batch(
    [
      'planning_order_relations',
      'planning_order_versions',
      'planning_orders',
      'planning_milestones',
      'planning_requests',
      'planning_projects',
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  );
});
it('LUUFI-5 verbindet Milestone-MCP und paginierte Browser-Leseansicht', async () => {
  const p = await project();
  const a = await call('milestones_create', {
    projectId: p.id,
    title: 'Erster',
    requestKey: 'milestone-a',
  });
  const b = await call('milestones_create', {
    projectId: p.id,
    title: 'Zweiter',
    requestKey: 'milestone-b',
  });
  expect(a).toMatchObject({ title: 'Erster', state: 'open' });
  const moved = await call('milestones_move', {
    projectId: p.id,
    id: b.id,
    beforeId: a.id,
    expectedPlanningRevision: 2,
    requestKey: 'move',
  });
  expect(moved).toMatchObject({ id: b.id, position: 0, revision: 1 });
  expect(
    await call('milestones_update', {
      projectId: p.id,
      id: a.id,
      title: 'Aktualisiert',
      expectedRevision: 0,
      requestKey: 'update',
    }),
  ).toMatchObject({ revision: 1, title: 'Aktualisiert' });
  const response = await milestones(
    request('/api/projects/x/milestones?limit=1'),
    { params: Promise.resolve({ projectId: p.id }) },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    items: [{ id: b.id }],
    nextCursor: expect.any(String),
  });
});
it('LUUFI-6 überträgt vollständige Spezifikationen über MCP und filtert dieselben Browserdaten', async () => {
  const p = await project();
  const spec = {
    title: 'Großer Entwurf',
    goal: 'Ziel',
    origin: 'Chat',
    problem: 'a'.repeat(4000),
    scope: 'b'.repeat(4000),
    exclusions: 'c'.repeat(4000),
    flows: 'd'.repeat(4000),
    testStrategy: 'e'.repeat(4000),
  };
  const order = await call('orders_create', {
    projectId: p.id,
    type: 'feature',
    spec,
    requestKey: 'order',
  });
  expect(order).toMatchObject({
    displayId: 'DEMO-1',
    specVersion: 1,
    revision: 0,
    status: 'draft',
  });
  const next = await call('orders_update_draft', {
    projectId: p.id,
    id: order.id,
    type: 'improvement',
    spec: { ...spec, title: 'Neuer Entwurf' },
    expectedRevision: 0,
    requestKey: 'new-version',
  });
  expect(next).toMatchObject({
    specVersion: 2,
    history: [
      { version: 1, spec: { title: 'Großer Entwurf' } },
      { version: 2, spec: { title: 'Neuer Entwurf' } },
    ],
  });
  const context = { params: Promise.resolve({ projectId: p.id }) };
  const response = await orders(
    request(
      '/api/projects/x/orders?milestoneId=unplanned&type=improvement&status=draft',
    ),
    context,
  );
  expect(await response.json()).toMatchObject({
    items: [{ id: order.id }],
    nextCursor: null,
  });
  expect(
    await call('orders_list', {
      projectId: p.id,
      milestoneId: null,
      type: 'improvement',
      status: 'draft',
    }),
  ).toMatchObject({ items: [{ id: order.id }], nextCursor: null });
  expect(
    await (
      await orderDetail(request('/api/projects/x/orders/y'), {
        params: Promise.resolve({
          projectId: p.id,
          orderId: order.id as string,
        }),
      })
    ).json(),
  ).toEqual(next);
  expect(
    (await orders(request('/api/projects/x/orders?status=made-up'), context))
      .status,
  ).toBe(400);
});
it('verlangt echte Sites-Identität und lehnt zusätzliche Zustands-/Identitätsfelder ab', async () => {
  const p = await project();
  expect(await call('orders_list', { projectId: p.id }, false)).toMatchObject({
    httpStatus: 401,
  });
  for (const extra of [
    { status: 'done' },
    { actor: 'owner' },
    { expectedRevision: -1 },
  ]) {
    expect(
      await call('orders_create', {
        projectId: p.id,
        type: 'feature',
        spec: { title: 'T', goal: 'G', origin: 'O' },
        requestKey: 'bad',
        ...extra,
      }),
    ).toMatchObject({ isError: true, code: 'validation' });
  }
  expect(
    await call('milestones_create', {
      projectId: p.id,
      title: 'T',
      state: 'closed',
      requestKey: 'closed',
    }),
  ).toMatchObject({ isError: true, code: 'validation' });
  expect(
    (
      await milestones(
        new Request('https://luufi.test/api/projects/x/milestones'),
        { params: Promise.resolve({ projectId: p.id }) },
      )
    ).status,
  ).toBe(401);
});

it('LUUFI-7 verbindet Zuordnung, Graphschutz und ursprüngliche Replay-Antworten über MCP', async () => {
  const p = await project();
  const m = await call('milestones_create', {
    projectId: p.id,
    title: 'Plan',
    requestKey: 'm',
  });
  const input = {
    projectId: p.id,
    type: 'feature',
    spec: { title: 'Entwurf', goal: 'Ziel', origin: 'Chat' },
  };
  const a = await call('orders_create', { ...input, requestKey: 'a' });
  const b = await call('orders_create', { ...input, requestKey: 'b' });
  expect(
    await call('orders_place', {
      projectId: p.id,
      id: a.id,
      milestoneId: m.id,
      beforeId: null,
      expectedRevision: 0,
      expectedPlanningRevision: 3,
      requestKey: 'place',
    }),
  ).toMatchObject({ milestoneId: m.id, revision: 1, specVersion: 1 });
  const edge = {
    projectId: p.id,
    id: a.id,
    targetId: b.id,
    type: 'depends_on',
    expectedRevision: 1,
    requestKey: 'edge',
  };
  const linked = await call('orders_relation_set', edge);
  expect(linked).toMatchObject({
    revision: 2,
    relations: [{ targetId: b.id, type: 'depends_on' }],
  });
  expect(
    await call('orders_relation_set', {
      ...edge,
      id: b.id,
      targetId: a.id,
      expectedRevision: 0,
      requestKey: 'cycle',
    }),
  ).toMatchObject({ isError: true, code: 'conflict' });
  expect(
    await call('orders_relation_remove', {
      ...edge,
      expectedRevision: 2,
      requestKey: 'remove',
    }),
  ).toMatchObject({ revision: 3, relations: [] });
  expect(await call('orders_relation_set', edge)).toEqual(linked);
});
