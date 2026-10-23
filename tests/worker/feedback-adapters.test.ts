import { env } from 'cloudflare:workers';
import { afterEach, expect, it } from 'vitest';
import { registerProject } from '@/lib/services/projects';
import { dispatchMcp } from '@/lib/mcp/route';
import {
  GET as list,
  POST as create,
} from '@/app/api/projects/[projectId]/feedback/route';
import { GET as detail } from '@/app/api/projects/[projectId]/feedback/[feedbackId]/route';
import {
  GET as entries,
  POST as append,
} from '@/app/api/projects/[projectId]/feedback/[feedbackId]/entries/route';
import { GET as refinements } from '@/app/api/projects/[projectId]/feedback/[feedbackId]/refinements/route';
import { GET as sources } from '@/app/api/projects/[projectId]/orders/[orderId]/feedback-sources/route';

const origin = 'https://luufi.test';
const headers = {
  'content-type': 'application/json',
  origin: origin,
  'oai-authenticated-user-id': 'owner',
};
const req = (body?: unknown, extra: Record<string, string> = {}) =>
  new Request(origin + '/api/projects/p/feedback', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...headers, ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
async function rpc(
  method: string,
  params: unknown,
  environment = 'production',
) {
  const response = await dispatchMcp(
    new Request(origin + '/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
    { ...env, LUUFI_ENVIRONMENT: environment },
  );
  return (await response.json()) as {
    result: {
      isError?: boolean;
      content: { text: string }[];
      tools: { name: string }[];
    };
    error?: unknown;
  };
}
async function call(name: string, args: unknown) {
  const body = await rpc('tools/call', {
    name,
    arguments: args,
    _meta: { actor: 'ignored' },
  });
  return {
    value: JSON.parse(body.result.content[0].text),
    isError: body.result.isError,
  };
}
async function project() {
  return registerProject(
    'owner',
    { key: 'DEMO', name: 'Demo', repository: 'example/demo' },
    crypto.randomUUID(),
  );
}
afterEach(async () => {
  await env.DB.batch(
    [
      'feedback_order_sources',
      'feedback_refinements',
      'feedback_attachments',
      'feedback_entries',
      'feedback_threads',
      'planning_order_relations',
      'planning_order_versions',
      'planning_orders',
      'planning_milestones',
      'planning_requests',
      'planning_projects',
    ].map((table) => env.DB.prepare('DELETE FROM ' + table)),
  );
});
it('LUUFI-10 verbindet Browsertext mit nativen Ergänzungen und Refinement', async () => {
  const p = await project(),
    context = { params: Promise.resolve({ projectId: p.id }) };
  const response = await create(
    req({ text: '  Original\r\n😀 ', requestKey: 'create' }),
    context,
  );
  expect(response.status).toBe(201);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const saved = (await response.json()) as {
    feedback: { id: string };
    entry: { text: string };
  };
  expect(saved.entry.text).toBe('  Original\r\n😀 ');
  const id = saved.feedback.id,
    ctx = { params: Promise.resolve({ projectId: p.id, feedbackId: id }) };
  expect((await list(req(), context)).status).toBe(200);
  expect(await (await detail(req(), ctx)).json()).toMatchObject({
    id,
    revision: 0,
    needsRefinement: true,
  });
  const added = await call('feedback_append', {
    projectId: p.id,
    id,
    text: 'Ergänzung',
    expectedRevision: 0,
    requestKey: 'append',
  });
  expect(added).toMatchObject({
    value: { feedback: { revision: 1 }, entry: { text: 'Ergänzung' } },
  });
  expect(
    await (
      await append(
        req({ text: 'Ergänzung', expectedRevision: 0, requestKey: 'append' }),
        ctx,
      )
    ).json(),
  ).toEqual(added.value);
  expect(await (await entries(req(), ctx)).json()).toMatchObject({
    items: [{ text: '  Original\r\n😀 ' }, { text: 'Ergänzung' }],
  });
  const input = {
    repositoryCommit: 'a'.repeat(40),
    documentationPolicy: '1.0.0',
    planningPolicy: '1.0.0',
    summary: 'Rückfrage',
    questions: ['Welcher Bildschirm?'],
  };
  expect(
    await call('feedback_refine', {
      projectId: p.id,
      id,
      input,
      expectedRevision: 1,
      requestKey: 'refine',
    }),
  ).toMatchObject({ value: { revision: 2, needsRefinement: false } });
  expect(await (await refinements(req(), ctx)).json()).toMatchObject({
    items: [{ summary: 'Rückfrage', inputContentRevision: 1 }],
  });
  expect(await call('feedback_get', { projectId: p.id, id })).toMatchObject({
    value: { revision: 2 },
  });
  expect(
    await call('feedback_entries_list', { projectId: p.id, id, limit: 1 }),
  ).toMatchObject({
    value: { items: [{ kind: 'original' }], nextCursor: expect.any(String) },
  });
  expect(await call('feedback_list', { projectId: p.id })).toMatchObject({
    value: { items: [{ id, entryCount: 2 }] },
  });
  expect(
    await call('feedback_refinements_list', { projectId: p.id, id }),
  ).toMatchObject({ value: { items: [{ summary: 'Rückfrage' }] } });
  expect(
    (
      await sources(req(), {
        params: Promise.resolve({ projectId: p.id, orderId: 'missing' }),
      })
    ).status,
  ).toBe(404);
  expect(
    await call('orders_feedback_sources', { projectId: p.id, id: 'missing' }),
  ).toMatchObject({ value: { code: 'not_found' }, isError: true });
});
it('LUUFI-10 bewahrt sämtliche 20.000 Unicode-Zeichen im begrenzten JSON-Transport', async () => {
  const p = await project(),
    ctx = { params: Promise.resolve({ projectId: p.id }) };
  const response = await create(
    req({ text: '界'.repeat(20000), requestKey: 'unicode' }),
    ctx,
  );
  expect(response.status).toBe(201);
  expect(
    ((await response.json()) as { entry: { text: string } }).entry.text,
  ).toHaveLength(20000);
});
it('LUUFI-10 schützt Mutationen durch Identität, exakten Origin und strikt begrenzte Bodies', async () => {
  const p = await project(),
    ctx = { params: Promise.resolve({ projectId: p.id }) };
  for (const [extra, status] of [
    [{ 'oai-authenticated-user-id': '' }, 401],
    [{ origin: 'https://foreign.test' }, 403],
    [{ origin: '' }, 403],
    [{ 'content-type': 'text/plain' }, 400],
    [{ 'content-length': '131073' }, 400],
  ] as [Record<string, string>, number][]) {
    const response = await create(
      req({ text: 'Privat', requestKey: 'blocked' }, extra),
      ctx,
    );
    expect(response.status).toBe(status);
  }
  for (const body of [
    [],
    { text: 'x', requestKey: 'bad', actor: 'spoofed' },
    { text: 'x'.repeat(131073), requestKey: 'large' },
  ]) {
    expect((await create(req(body), ctx)).status).toBe(400);
  }
  const invalid = new Request(origin + '/api/projects/p/feedback', {
    method: 'POST',
    headers,
    body: '{bad',
  });
  expect((await create(invalid, ctx)).status).toBe(400);
  expect(await (await list(req(), ctx)).json()).toMatchObject({ items: [] });
});
it('LUUFI-10/11 bietet alle produktiven Werkzeuge an und hält ungültige Argumente strukturiert', async () => {
  const listed = await rpc('tools/list', {});
  expect(listed.result.tools.map((t) => t.name)).toEqual(
    expect.arrayContaining([
      'feedback_list',
      'feedback_create',
      'feedback_append',
      'feedback_refine',
      'orders_feedback_sources',
      'media_get',
      'media_read',
      'media_cleanup',
    ]),
  );
  expect(listed.result.tools.map((t) => t.name)).not.toContain('probe_write');
  for (const [name, args] of [
    [
      'feedback_create',
      { projectId: 'p', text: 'x', requestKey: 'key', actor: 'spoofed' },
    ],
    [
      'feedback_append',
      {
        projectId: 'p',
        id: 'f',
        text: 'x',
        expectedRevision: -1,
        requestKey: 'key',
      },
    ],
    [
      'feedback_refine',
      {
        projectId: 'p',
        id: 'f',
        input: { summary: 'x' },
        expectedRevision: 0,
        requestKey: 'key',
      },
    ],
    [
      'media_read',
      { projectId: 'p', feedbackId: 'f', id: 'a', offset: 0, length: 65537 },
    ],
    ['media_cleanup', { limit: 51, requestKey: 'key' }],
  ] as const)
    expect(await call(name, args)).toMatchObject({
      value: { code: 'validation' },
      isError: true,
    });
  expect(
    await call('media_get', { projectId: 'p', feedbackId: 'f', id: 'a' }),
  ).toMatchObject({ value: { code: 'not_found' }, isError: true });
});
