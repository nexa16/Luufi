import { env } from 'cloudflare:workers';
import { afterEach, expect, it, vi } from 'vitest';
import { GET as list } from '@/app/api/projects/route';
import { GET as detail } from '@/app/api/projects/[projectId]/route';
import { dispatchMcp } from '@/lib/mcp/route';

const headers = {
  'content-type': 'application/json',
  'oai-authenticated-user-id': 'owner',
};
const bindings = { ...env, LUUFI_ENVIRONMENT: 'preview' };
async function call(name: string, args: unknown) {
  const response = await dispatchMcp(
    new Request('https://luufi.test/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    }),
    bindings,
  );
  return response.json() as Promise<{
    result: { isError?: boolean; content: { text: string }[] };
  }>;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await env.DB.prepare('DELETE FROM planning_requests').run();
  await env.DB.prepare('DELETE FROM planning_projects').run();
});
it('LUUFI-4 nutzt native Projektverwaltung und geschützte Browser-Leseverträge mit denselben Daten', async () => {
  const response = await call('projects_register', {
    key: 'DEMO',
    name: 'Beispiel',
    repository: 'example/demo',
    requestKey: 'create',
  });
  expect(response.result.isError).toBeUndefined();
  const project = JSON.parse(response.result.content[0].text);
  const request = new Request('https://luufi.test/api/projects', { headers });
  const listed = await list(request);
  expect(listed.status).toBe(200);
  expect(listed.headers.get('cache-control')).toBe('no-store');
  expect(await listed.json()).toEqual({ items: [project], nextCursor: null });
  expect(
    await (
      await detail(request, {
        params: Promise.resolve({ projectId: project.id }),
      })
    ).json(),
  ).toEqual(project);
  const changed = await call('projects_update', {
    id: project.id,
    name: 'Neuer Name',
    repository: 'example/demo',
    expectedRevision: 0,
    requestKey: 'update',
  });
  expect(JSON.parse(changed.result.content[0].text)).toMatchObject({
    name: 'Neuer Name',
    revision: 1,
  });
});
it('LUUFI-4 weist native Zusatzfelder und Statusmanipulation zurück', async () => {
  for (const extra of [
    { actor: 'other' },
    { status: 'done' },
    { expectedRevision: -1 },
  ]) {
    const response = await call('projects_register', {
      key: 'DEMO',
      name: 'Beispiel',
      repository: 'example/demo',
      requestKey: 'create',
      ...extra,
    });
    expect(response.result.isError).toBe(true);
    expect(JSON.parse(response.result.content[0].text).code).toBe('validation');
  }
  expect(
    (await list(new Request('https://luufi.test/api/projects'))).status,
  ).toBe(401);
  const missing = await detail(
    new Request('https://luufi.test/api/projects/missing', { headers }),
    { params: Promise.resolve({ projectId: 'missing' }) },
  );
  expect(missing.status).toBe(404);
});
it('LUUFI-4 begrenzt Listen und gibt bei Ausfällen keine D1-Details preis', async () => {
  expect(
    (
      await list(
        new Request('https://luufi.test/api/projects?limit=NaN', { headers }),
      )
    ).status,
  ).toBe(400);
  vi.spyOn(env.DB, 'prepare').mockImplementation(() => {
    throw new Error('PRIVATE SQL SECRET');
  });
  const response = await list(
    new Request('https://luufi.test/api/projects', { headers }),
  );
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('PRIVATE');
});
