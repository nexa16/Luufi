import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET as GET_ONE, PATCH } from '@/app/api/ideas/[id]/route';
import { GET, POST } from '@/app/api/ideas/route';
import * as service from '@/lib/services/project-ideas';
import type { ProjectIdea } from '@/lib/domain/project-ideas';

const base = 'https://luufi.test';
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const content = {
  text: 'Idee',
  detail: 'Beschreibung',
  requestKey: 'create-key',
};
function request(
  method: string = 'GET',
  body?: unknown,
  path = '/api/ideas',
  headers: Record<string, string> = {},
): Request {
  const payload = body === undefined ? {} : { body: JSON.stringify(body) };
  return new Request(`${base}${path}`, {
    method,
    headers: {
      'oai-authenticated-user-id': 'owner',
      Origin: base,
      'Content-Type': 'application/json',
      ...headers,
    },
    ...payload,
  });
}
async function create() {
  const response = await POST(request('POST', content));
  expect(response.status).toBe(201);
  return ((await response.json()) as { idea: ProjectIdea }).idea;
}

describe('LUUFI-3 geschützte Browser-API', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await env.DB.prepare('DELETE FROM idea_mutation_requests').run();
    await env.DB.prepare('DELETE FROM project_ideas').run();
  });

  it('erstellt, liest, bearbeitet und löscht mit dauerhaftem Replay', async () => {
    const first = await create();
    expect(first).toMatchObject({
      text: 'Idee',
      detail: 'Beschreibung',
      revision: 0,
    });
    const page = await GET(request());
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(await page.json()).toEqual({ items: [first], nextCursor: null });
    expect(
      await GET_ONE(request(), context(first.id)).then((res) => res.json()),
    ).toEqual({ idea: first });
    const body = {
      text: 'Verbessert',
      detail: '',
      expectedRevision: 0,
      requestKey: 'update-key',
    };
    const updated = await PATCH(request('PATCH', body), context(first.id));
    expect(updated.status).toBe(200);
    const changed = { ...first, text: 'Verbessert', detail: '', revision: 1 };
    expect(await updated.json()).toEqual({ idea: changed });
    expect(
      await PATCH(request('PATCH', body), context(first.id)).then((res) =>
        res.json(),
      ),
    ).toEqual({ idea: changed });
    const deleted = { expectedRevision: 1, requestKey: 'delete-key' };
    expect(
      await DELETE(request('DELETE', deleted), context(first.id)).then((res) =>
        res.json(),
      ),
    ).toEqual({ id: first.id, deleted: true, revision: 1 });
    expect(
      (await DELETE(request('DELETE', deleted), context(first.id))).status,
    ).toBe(200);
    expect((await GET_ONE(request(), context(first.id))).status).toBe(404);
    expect(await GET(request()).then((res) => res.json())).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it('liefert Konflikte für veraltete Revision und geänderten Wiederholungsinhalt', async () => {
    const first = await create();
    expect(
      (await POST(request('POST', { ...content, text: 'Anders' }))).status,
    ).toBe(409);
    expect(
      (
        await PATCH(
          request('PATCH', {
            text: 'Neu',
            expectedRevision: 1,
            requestKey: 'stale-patch',
          }),
          context(first.id),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await DELETE(
          request('DELETE', {
            expectedRevision: 1,
            requestKey: 'stale-delete',
          }),
          context(first.id),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await PATCH(
          request('PATCH', {
            text: 'Neu',
            expectedRevision: 0,
            requestKey: 'missing',
          }),
          context('missing'),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await DELETE(
          request('DELETE', {
            expectedRevision: 0,
            requestKey: 'missing-delete',
          }),
          context('missing'),
        )
      ).status,
    ).toBe(404);
  });

  it('verlangt für jede Route Sites-Identität', async () => {
    const anonymous = (method: string = 'GET') =>
      new Request(`${base}/api/ideas`, {
        method,
        ...(method === 'GET' ? {} : { body: '{}' }),
      });
    const responses = await Promise.all([
      GET(anonymous()),
      POST(anonymous('POST')),
      GET_ONE(anonymous(), context('id')),
      PATCH(anonymous('PATCH'), context('id')),
      DELETE(anonymous('DELETE'), context('id')),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({
        error: 'Bitte melde dich bei Luufi an.',
        code: 'unauthorized',
      });
    }
  });

  it.each(['https://attacker.test', 'null', ''])(
    'weist fremden oder fehlenden Origin ab: %s',
    async (origin) => {
      const make = (method: string) =>
        request(method, content, '/api/ideas', { Origin: origin });
      for (const response of [
        await POST(make('POST')),
        await PATCH(make('PATCH'), context('id')),
        await DELETE(make('DELETE'), context('id')),
      ]) {
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: 'forbidden' });
      }
    },
  );

  it('reicht Seitenparameter durch und meldet ungültige Werte', async () => {
    await create();
    await POST(request('POST', { ...content, requestKey: 'second' }));
    const response = await GET(request('GET', undefined, '/api/ideas?limit=1'));
    const first = (await response.json()) as {
      items: ProjectIdea[];
      nextCursor: string;
    };
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));
    const next = await GET(
      request(
        'GET',
        undefined,
        `/api/ideas?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`,
      ),
    );
    const second = (await next.json()) as {
      items: ProjectIdea[];
      nextCursor: string | null;
    };
    expect(second.items).toHaveLength(1);
    expect(second.items[0].id).not.toBe(first.items[0].id);
    expect(second.nextCursor).toBeNull();
    for (const query of [
      'limit=0',
      'limit=51',
      'limit=x',
      'limit=1.5',
      'limit=',
      'cursor=invalid',
    ]) {
      expect(
        (await GET(request('GET', undefined, `/api/ideas?${query}`))).status,
      ).toBe(400);
    }
  });

  it('weist ungültige Nutzdaten, Revisionen und Schlüssel zurück', async () => {
    const first = await create();
    for (const body of [
      {},
      { text: ' ' },
      { text: 'x'.repeat(281), requestKey: 'key' },
      { text: 'A', detail: 'd'.repeat(4001), requestKey: 'key' },
      { text: 'A', requestKey: 'bad key' },
    ]) {
      expect((await POST(request('POST', body))).status).toBe(400);
    }
    expect(
      (
        await PATCH(
          request('PATCH', { text: 'A', requestKey: 'key' }),
          context(first.id),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await DELETE(
          request('DELETE', { expectedRevision: -1, requestKey: 'key' }),
          context(first.id),
        )
      ).status,
    ).toBe(400);
  });

  it('begrenzt JSON auf echte 32 KiB und weist fehlerhafte Formate ab', async () => {
    const headers = {
      'oai-authenticated-user-id': 'owner',
      Origin: base,
      'Content-Type': 'application/json',
    };
    for (const body of [
      '{',
      'null',
      '[]',
      JSON.stringify({ text: 'ä'.repeat(17000) }),
    ]) {
      expect(
        (
          await POST(
            new Request(`${base}/api/ideas`, { method: 'POST', headers, body }),
          )
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await POST(
          request('POST', content, '/api/ideas', { 'Content-Length': '32769' }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request('POST', content, '/api/ideas', { 'Content-Length': 'no' }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request('POST', content, '/api/ideas', {
            'Content-Type': 'text/plain',
          }),
        )
      ).status,
    ).toBe(400);
    expect((await POST(request('POST'))).status).toBe(400);
    const unreadable = request('POST', content);
    vi.spyOn(unreadable.body!, 'getReader').mockReturnValue({
      read: async () => {
        throw new Error('PRIVATE STREAM');
      },
      releaseLock: vi.fn(),
    } as unknown as ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>);
    expect((await POST(unreadable)).status).toBe(400);
  });

  it('bereinigt unerwartete Fehler jeder Route ohne interne Details', async () => {
    for (const [method, call] of [
      ['listProjectIdeas', () => GET(request())],
      ['getProjectIdea', () => GET_ONE(request(), context('id'))],
      ['createProjectIdea', () => POST(request('POST', content))],
      [
        'updateProjectIdea',
        () =>
          PATCH(
            request('PATCH', { ...content, expectedRevision: 0 }),
            context('id'),
          ),
      ],
      [
        'deleteProjectIdea',
        () =>
          DELETE(
            request('DELETE', { expectedRevision: 0, requestKey: 'key' }),
            context('id'),
          ),
      ],
    ] as const) {
      vi.spyOn(service, method).mockRejectedValueOnce(
        new Error('PRIVATE SECRET'),
      );
      const response = await call();
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({
        code: 'unavailable',
        error: expect.not.stringContaining('PRIVATE'),
      });
    }
  });
});
