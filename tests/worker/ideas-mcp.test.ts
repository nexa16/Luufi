import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchMcp } from '@/lib/mcp/route';
import { callIdeaTool, ideaTools, validIdeaArguments } from '@/lib/mcp/ideas';
import * as service from '@/lib/services/project-ideas';
import type { ProjectIdea } from '@/lib/domain/project-ideas';

const production = { ...env, LUUFI_ENVIRONMENT: 'production' };
function request(
  method: string,
  params: unknown = {},
  actor: string | null = 'owner',
) {
  return new Request('https://luufi.test/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(actor ? { 'oai-authenticated-user-id': actor } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 5, method, params }),
  });
}
async function invoke(
  name: string,
  args: Record<string, unknown> = {},
  actor: string | null = 'owner',
) {
  const response = await dispatchMcp(
    request(
      'tools/call',
      {
        name,
        arguments: args,
        _meta: { ownerId: 'forged-owner', 'openai/subject': 'forged-subject' },
      },
      actor,
    ),
    production,
  );
  const body = (await response.json()) as {
    result: {
      content: { text: string }[];
      isError?: boolean;
      resultType: string;
    };
  };
  expect(response.status).toBe(200);
  expect(body.result.resultType).toBe('complete');
  return {
    value: JSON.parse(body.result.content[0].text),
    isError: body.result.isError,
  };
}
const input = {
  text: 'Native Projektidee',
  detail: 'Privat und eigenständig',
  requestKey: 'native-create',
};

describe('LUUFI-3 native Projektideen-Werkzeuge', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await env.DB.prepare('DELETE FROM idea_mutation_requests').run();
    await env.DB.prepare('DELETE FROM project_ideas').run();
  });

  it('veröffentlicht statische strikte Schemas auch ohne Anmeldung; Produktion hat keine Probe', async () => {
    for (const environment of ['preview', 'production']) {
      const result = (await (
        await dispatchMcp(request('tools/list', {}, null), {
          ...production,
          LUUFI_ENVIRONMENT: environment,
        })
      ).json()) as {
        result: {
          tools: { name: string; inputSchema: unknown; annotations: unknown }[];
        };
      };
      const tools = result.result.tools;
      expect(
        tools
          .filter((tool) => tool.name.startsWith('ideas_'))
          .map((tool) => tool.name),
      ).toEqual(ideaTools.map((tool) => tool.name));
      if (environment === 'production')
        expect(tools.map((tool) => tool.name)).toEqual([
          'get_context',
          'get_guidelines',
          'ideas_list',
          'ideas_get',
          'ideas_create',
          'ideas_update',
          'ideas_delete',
        ]);
      expect(tools.find((tool) => tool.name === 'ideas_update')).toMatchObject({
        inputSchema: {
          required: ['id', 'text', 'expectedRevision', 'requestKey'],
          additionalProperties: false,
          properties: {
            expectedRevision: { type: 'integer', minimum: 0 },
            requestKey: { minLength: 1, maxLength: 128 },
          },
        },
        annotations: { idempotentHint: true },
      });
      expect(tools.find((tool) => tool.name === 'ideas_delete')).toMatchObject({
        annotations: { destructiveHint: true },
      });
    }
    for (const { name } of ideaTools) {
      expect(
        (
          await dispatchMcp(
            request(
              'tools/call',
              { name, arguments: input, _meta: { ownerId: 'forged' } },
              null,
            ),
            production,
          )
        ).status,
      ).toBe(401);
    }
  });

  it('nutzt beim vollständigen CRUD ausschließlich die native Identität und gemeinsame D1', async () => {
    const first = await invoke('ideas_create', input);
    expect(first.isError).toBeUndefined();
    const idea = first.value as ProjectIdea;
    expect(idea).toMatchObject({
      text: input.text,
      detail: input.detail,
      revision: 0,
    });
    expect((await invoke('ideas_get', { id: idea.id })).value).toEqual(idea);
    expect((await invoke('ideas_list')).value).toEqual({
      items: [idea],
      nextCursor: null,
    });
    expect((await invoke('ideas_create', input)).value).toEqual(idea);
    const row = await env.DB.prepare(
      'SELECT payload_json FROM idea_mutation_requests WHERE request_key = ?',
    )
      .bind(input.requestKey)
      .first<{ payload_json: string }>();
    expect(JSON.parse(row!.payload_json).actor).toBe('owner');
    expect(row!.payload_json).not.toMatch(/forged/);
    const changed = {
      id: idea.id,
      text: 'Bearbeitet',
      detail: '',
      expectedRevision: 0,
      requestKey: 'native-update',
    };
    const updated = (await invoke('ideas_update', changed))
      .value as ProjectIdea;
    expect(updated).toEqual({
      ...idea,
      text: 'Bearbeitet',
      detail: '',
      revision: 1,
    });
    expect(await service.getProjectIdea('owner', idea.id)).toEqual(updated);
    expect((await invoke('ideas_update', changed)).value).toEqual(updated);
    const deleted = {
      id: idea.id,
      expectedRevision: 1,
      requestKey: 'native-delete',
    };
    expect((await invoke('ideas_delete', deleted)).value).toEqual({
      id: idea.id,
      deleted: true,
      revision: 1,
    });
    expect((await invoke('ideas_delete', deleted)).isError).toBeUndefined();
    expect((await invoke('ideas_create', input)).value).toEqual(idea);
    expect((await invoke('ideas_update', changed)).value).toEqual(updated);
    expect((await invoke('ideas_list')).value).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it('bewahrt Revisions-, Inhalts- und Identitätskonflikte aus dem gemeinsamen Service', async () => {
    const idea = (await invoke('ideas_create', input)).value as ProjectIdea;
    for (const [name, args, actor] of [
      ['ideas_create', { ...input, text: 'Anders' }, 'owner'],
      ['ideas_create', input, 'other-authenticated-owner'],
      [
        'ideas_update',
        {
          id: idea.id,
          text: 'Neu',
          expectedRevision: 1,
          requestKey: 'stale-update',
        },
        'owner',
      ],
      [
        'ideas_delete',
        { id: idea.id, expectedRevision: 1, requestKey: 'stale-delete' },
        'owner',
      ],
    ] as const) {
      const failure = await invoke(name, args, actor);
      expect(failure.isError).toBe(true);
      expect(failure.value).toMatchObject({
        code: 'conflict',
        error: expect.any(String),
      });
    }
    expect(await service.getProjectIdea('owner', idea.id)).toEqual(idea);
  });

  it('paginiert über dieselben stabilen Schlüssel und meldet fehlende Ideen', async () => {
    for (const id of ['a', 'b', 'c']) {
      await env.DB.prepare(
        'INSERT INTO project_ideas (id, idea_text, detail, created_at) VALUES (?, ?, ?, ?)',
      )
        .bind(id, id, '', 10)
        .run();
    }
    const page = (await invoke('ideas_list', { limit: 2 })).value as {
      items: ProjectIdea[];
      nextCursor: string;
    };
    expect(page.items.map((idea) => idea.id)).toEqual(['c', 'b']);
    expect(
      (
        await invoke('ideas_list', { limit: 2, cursor: page.nextCursor })
      ).value.items.map((idea: ProjectIdea) => idea.id),
    ).toEqual(['a']);
    expect((await invoke('ideas_get', { id: 'missing' })).value).toMatchObject({
      code: 'not_found',
    });
    expect((await invoke('ideas_list', { cursor: '%' })).value).toMatchObject({
      code: 'validation',
    });
  });

  it.each([
    ['ideas_list', { limit: 0 }],
    ['ideas_list', { limit: 51 }],
    ['ideas_list', { limit: 1.5 }],
    ['ideas_list', { limit: '1' }],
    ['ideas_list', { cursor: '' }],
    ['ideas_list', { cursor: 'x'.repeat(1025) }],
    ['ideas_list', { sql: 'SELECT *' }],
    ['ideas_get', {}],
    ['ideas_get', { id: 1 }],
    ['ideas_get', { id: '' }],
    ['ideas_create', {}],
    ['ideas_create', { text: 'Idee' }],
    ['ideas_create', { ...input, detail: null }],
    ['ideas_create', { ...input, text: 'x'.repeat(281) }],
    ['ideas_create', { ...input, detail: 'x'.repeat(4001) }],
    ['ideas_create', { ...input, requestKey: 'bad key' }],
    ['ideas_create', { ...input, requestKey: 'x'.repeat(129) }],
    ['ideas_create', { ...input, actor: 'injected' }],
    ['ideas_create', { ...input, ownerId: 'injected' }],
    ['ideas_update', { id: 'id', text: 'Idee', requestKey: 'key' }],
    [
      'ideas_update',
      { id: 'id', text: 'Idee', requestKey: 'key', expectedRevision: -1 },
    ],
    [
      'ideas_delete',
      {
        id: 'id',
        requestKey: 'key',
        expectedRevision: Number.MAX_SAFE_INTEGER + 1,
      },
    ],
  ])('weist ungültige Werkzeugargumente ab: %s %j', async (name, args) => {
    const result = await invoke(name, args);
    expect(result).toMatchObject({
      isError: true,
      value: { code: 'validation' },
    });
    expect((await service.listProjectIdeas('owner')).items).toEqual([]);
  });

  it('begrenzt nur den Umfang, lässt die fachliche Validierung aber beim Service', async () => {
    expect(
      (await invoke('ideas_create', { ...input, text: ' ' })).value,
    ).toMatchObject({
      code: 'validation',
      error: 'Bitte gib eine Projektidee ein.',
    });
    expect(validIdeaArguments('unknown', {})).toBe(false);
    const unknown = await callIdeaTool('unknown', {}, 'owner');
    expect(unknown.isError).toBe(true);
  });

  it('bereinigt unbekannte Fehler ohne SQL-, Credential- oder Stackdetails', async () => {
    vi.spyOn(service, 'listProjectIdeas').mockRejectedValueOnce(
      new Error('PRIVATE TOKEN SQL STACK'),
    );
    const failure = await invoke('ideas_list');
    expect(failure).toMatchObject({
      isError: true,
      value: { code: 'unavailable' },
    });
    expect(JSON.stringify(failure)).not.toMatch(/PRIVATE|TOKEN|SQL|STACK/);
    vi.spyOn(env.DB, 'prepare').mockImplementation(() => {
      throw new Error('PRIVATE DATABASE');
    });
    expect((await invoke('ideas_create', input)).value).toMatchObject({
      code: 'unavailable',
    });
  });
});
