import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchMcp } from '@/lib/mcp/route';
import { getGuideline } from '@/lib/mcp/guidelines';
import { readProbe, writeProbe } from '@/lib/mcp/storage';
import * as route from '@/app/mcp/route';
import '@/lib/mcp/service.test';

const preview = { ...env, LUUFI_ENVIRONMENT: 'preview' };
const metadata = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
};
function request(
  method: string,
  params: unknown = {},
  identity: string | null = 'owner',
) {
  return new Request('https://luufi.test/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(identity ? { 'oai-authenticated-user-id': identity } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}
function call(
  name: string,
  args: unknown = {},
  identity: string | null = 'owner',
) {
  return request(
    'tools/call',
    { name, arguments: args, _meta: metadata },
    identity,
  );
}
async function payload(response: Response) {
  const rpc = (await response.json()) as {
    result: {
      content: { text: string }[];
      isError?: boolean;
      resultType: string;
    };
  };
  expect(rpc.result.resultType).toBe('complete');
  return JSON.parse(rpc.result.content[0].text);
}

describe('LUUFI-2 native Plattform-MCP', () => {
  it.each([
    ['Mcp-Name', 'get_context', '2026-07-28', -32020],
    ['Mcp-Method', 'tools/list', '2026-07-28', -32020],
    ['MCP-Protocol-Version', '1900-01-01', '1900-01-01', -32022],
    ['MCP-Protocol-Version', '2026-07-28', '1900-01-01', -32020],
    ['MCP-Protocol-Version', '1900-01-01', '2026-07-28', -32020],
    [undefined, undefined, '1900-01-01', -32022],
  ])(
    'verhindert falsch klassifizierte MCP-Mutationen: %s/%s/%s',
    async (header, value, version, code) => {
      const prepare = vi.spyOn(env.DB, 'prepare');
      const input = request('tools/call', {
        name: 'ideas_delete',
        arguments: {
          id: 'victim',
          expectedRevision: 0,
          requestKey: 'misclassified',
        },
        _meta: {
          ...metadata,
          'io.modelcontextprotocol/protocolVersion': version,
        },
      });
      if (header !== undefined) input.headers.set(header, value!);
      const response = await dispatchMcp(input, preview);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        jsonrpc: '2.0',
        error: { code },
      });
      expect(prepare).not.toHaveBeenCalled();
    },
  );
  it('akzeptiert passende native Header ohne Metadaten als Identität zu verwenden', async () => {
    const input = call('get_context');
    input.headers.set('Mcp-Method', 'tools/call');
    input.headers.set('Mcp-Name', 'get_context');
    input.headers.set('MCP-Protocol-Version', '2026-07-28');
    expect((await dispatchMcp(input, preview)).status).toBe(200);
  });
  it.each([
    'https://attacker.test',
    'null',
    'https://luufi.test.attacker.test',
  ])('weist fremden MCP-Origin vor Datenzugriff ab: %s', async (origin) => {
    const prepare = vi.fn();
    const input = call('probe_write', {
      expectedRevision: 0,
      value: 'unwanted',
      requestKey: 'foreign',
    });
    input.headers.set('origin', origin);
    const response = await dispatchMcp(input, {
      DB: { prepare } as unknown as D1Database,
      LUUFI_ENVIRONMENT: 'preview',
    });
    expect(response.status).toBe(403);
    expect(prepare).not.toHaveBeenCalled();
  });
  it.each([undefined, 'text/plain', 'text/json'])(
    'verlangt JSON-Content-Type vor Datenzugriff: %s',
    async (contentType) => {
      const prepare = vi.fn();
      const input = call('probe_write', {
        expectedRevision: 0,
        value: 'unwanted',
        requestKey: 'wrong-content-type',
      });
      if (contentType === undefined) input.headers.delete('content-type');
      else input.headers.set('content-type', contentType);
      expect(
        (
          await dispatchMcp(input, {
            DB: { prepare } as unknown as D1Database,
            LUUFI_ENVIRONMENT: 'preview',
          })
        ).status,
      ).toBe(415);
      expect(prepare).not.toHaveBeenCalled();
    },
  );
  it.each([undefined, 'https://luufi.test'])(
    'erlaubt native Aufrufe und eigenen Origin mit JSON-Parametern: %s',
    async (origin) => {
      const input = call('get_context');
      if (origin !== undefined) input.headers.set('origin', origin);
      input.headers.set('content-type', 'application/json; charset=utf-8');
      expect((await dispatchMcp(input, preview)).status).toBe(200);
    },
  );
  afterEach(async () => {
    vi.restoreAllMocks();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM luufi_mcp_probe_writes'),
      env.DB.prepare('DELETE FROM luufi_mcp_probe_records'),
    ]);
  });
  it('stellt statische Discovery bereit und schützt alle Datenwerkzeuge', async () => {
    expect(
      (
        await dispatchMcp(
          request('server/discover', { _meta: metadata }, null),
          preview,
        )
      ).status,
    ).toBe(200);
    const discovery = await dispatchMcp(
      request('tools/list', { _meta: metadata }, null),
      preview,
    );
    expect(await discovery.json()).toMatchObject({
      result: {
        resultType: 'complete',
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'get_context' }),
        ]),
      },
    });
    for (const name of [
      'get_context',
      'get_guidelines',
      'probe_read',
      'probe_write',
      'read_probe_attachment',
    ]) {
      expect((await dispatchMcp(call(name, {}, null), preview)).status).toBe(
        401,
      );
    }
    expect(
      (await dispatchMcp(call('get_context', {}, 'x'.repeat(257)), preview))
        .status,
    ).toBe(401);
  });
  it('liefert exakten Kontext und echte Bereitschaft', async () => {
    const result = await payload(
      await dispatchMcp(call('get_context'), preview),
    );
    expect(result).toEqual({
      status: 'ok',
      commitSha: env.LUUFI_COMMIT_SHA,
      environment: 'preview',
      sourceBranch: env.LUUFI_SOURCE_BRANCH,
    });
  });
  it('bietet in Produktion Kontext, Richtlinien und Projektideen ohne Probe-Werkzeuge', async () => {
    const production = {
      ...preview,
      LUUFI_ENVIRONMENT: 'production',
      LUUFI_SOURCE_BRANCH: 'main',
    };
    const listed = (await (
      await dispatchMcp(request('tools/list'), production)
    ).json()) as { result: { tools: { name: string }[] } };
    expect(listed.result.tools.map((tool) => tool.name)).toEqual([
      'get_context',
      'get_guidelines',
      'ideas_list',
      'ideas_get',
      'ideas_create',
      'ideas_update',
      'ideas_delete',
      'projects_list',
      'projects_get',
      'projects_register',
      'projects_update',
      'milestones_list',
      'milestones_get',
      'milestones_create',
      'milestones_update',
      'milestones_move',
      'orders_list',
      'orders_get',
      'orders_create',
      'orders_update_draft',
      'orders_place',
      'orders_relation_set',
      'orders_relation_remove',
      'feedback_list',
      'feedback_get',
      'feedback_entries_list',
      'feedback_refinements_list',
      'feedback_create',
      'feedback_append',
      'feedback_refine',
      'orders_feedback_sources',
      'media_get',
      'media_read',
      'media_cleanup',
      'orders_mark_ready',
      'orders_return_to_draft',
      'orders_archive',
      'approvals_create',
      'approvals_revoke',
      'approvals_items',
      'orders_approvals',
      'orders_lifecycle',
      'orders_progress',
      'orders_events',
      'orders_start',
      'orders_pause',
      'orders_resume',
      'orders_takeover',
      'orders_stop',
      'orders_progress_append',
      'milestones_close',
      'orders_validation_record',
      'orders_implementation_record',
      'orders_integration_record',
      'orders_evidence',
    ]);
    for (const name of ['probe_read', 'probe_write', 'read_probe_attachment']) {
      expect(
        await (await dispatchMcp(call(name), production)).json(),
      ).toMatchObject({ result: { isError: true } });
    }
    expect(await readProbe(env.DB, 'owner')).toBeNull();
    expect(
      await payload(await dispatchMcp(call('get_context'), production)),
    ).toMatchObject({ environment: 'production', sourceBranch: 'main' });
  });
  it('prüft Revisionen, getrennte Eigentümer und persistentes Replay', async () => {
    expect(
      await payload(await dispatchMcp(call('probe_read'), preview)),
    ).toBeNull();
    const first = { expectedRevision: 0, value: 'eins', requestKey: 'eins' };
    expect(
      await payload(await dispatchMcp(call('probe_write', first), preview)),
    ).toEqual({ revision: 1, value: 'eins', replayed: false });
    expect(
      await (
        await dispatchMcp(
          call('probe_write', { ...first, value: 'anders' }),
          preview,
        )
      ).json(),
    ).toMatchObject({ result: { isError: true } });
    expect(
      await (
        await dispatchMcp(
          call('probe_write', { ...first, requestKey: 'alt' }),
          preview,
        )
      ).json(),
    ).toMatchObject({ result: { isError: true } });
    await payload(
      await dispatchMcp(
        call('probe_write', {
          expectedRevision: 1,
          value: 'zwei',
          requestKey: 'zwei',
        }),
        preview,
      ),
    );
    expect(
      await payload(await dispatchMcp(call('probe_write', first), preview)),
    ).toEqual({ revision: 1, value: 'eins', replayed: true });
    expect(
      await payload(await dispatchMcp(call('probe_read'), preview)),
    ).toEqual({ revision: 2, value: 'zwei' });
    expect(
      await payload(
        await dispatchMcp(call('probe_read', {}, 'other-owner'), preview),
      ),
    ).toBeNull();
  });
  it('erlaubt nur eine konkurrierende Änderung je Revision', async () => {
    const results = await Promise.allSettled(
      ['eins', 'zwei'].map((value) =>
        writeProbe(env.DB, 'owner', {
          expectedRevision: 0,
          value,
          requestKey: value,
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect((await readProbe(env.DB, 'owner'))?.revision).toBe(1);
  });
  it.each(['documentation', 'planning', 'implementation', 'data-access'])(
    'liefert die versionierte Richtlinie %s mit exaktem Hash',
    async (id) => {
      const result = await payload(
        await dispatchMcp(call('get_guidelines', { id }), preview),
      );
      expect(result.version).toBe(
        ['data-access', 'implementation'].includes(id) ? '1.0.1' : '1.0.0',
      );
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(result.content),
      );
      expect(result.sha256).toBe(
        Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join(''),
      );
    },
  );
  it('verwirft unbekannte Richtlinien und liefert den synthetischen Anhang', async () => {
    await expect(getGuideline('../private')).rejects.toThrow(
      'Unbekannte Richtlinie.',
    );
    expect(
      await payload(await dispatchMcp(call('read_probe_attachment'), preview)),
    ).toMatchObject({
      filename: 'luufi-mcp-proof.txt',
      mimeType: 'text/plain',
      base64: expect.any(String),
    });
  });
  it('begrenzt Transport und verarbeitet keine ungültigen Bodies', async () => {
    const prepare = vi.fn();
    const bindings = {
      DB: { prepare } as unknown as D1Database,
      LUUFI_ENVIRONMENT: 'preview',
    };
    expect(
      (
        await dispatchMcp(call('probe_read'), {
          ...bindings,
          LUUFI_ENVIRONMENT: 'other',
        })
      ).status,
    ).toBe(404);
    for (const handler of [
      route.GET,
      route.PUT,
      route.PATCH,
      route.DELETE,
      route.OPTIONS,
      route.HEAD,
    ]) {
      expect(
        (await handler(new Request('https://luufi.test/mcp'))).status,
      ).toBe(405);
    }
    expect((await route.POST(call('get_context'))).status).toBe(200);
    for (const body of ['{', '', new Uint8Array([0xff])]) {
      expect(
        (
          await dispatchMcp(
            new Request('https://luufi.test/mcp', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body,
            }),
            bindings,
          )
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await dispatchMcp(
          new Request('https://luufi.test/mcp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          }),
          bindings,
        )
      ).status,
    ).toBe(400);
    for (const length of ['262145', 'wrong']) {
      const input = call('probe_read');
      input.headers.set('content-length', length);
      expect((await dispatchMcp(input, bindings)).status).toBe(413);
    }
    expect(
      (
        await dispatchMcp(
          new Request('https://luufi.test/mcp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: 'x'.repeat(262145),
          }),
          bindings,
        )
      ).status,
    ).toBe(413);
    expect(prepare).not.toHaveBeenCalled();
  });
  it('beantwortet Notifications ohne Datenzugriff und bereinigt interne Fehler', async () => {
    const notification = new Request('https://luufi.test/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    });
    const response = await dispatchMcp(notification, preview);
    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const bindings = {
      ...preview,
      DB: {
        prepare: () => {
          throw new Error('PRIVATE');
        },
      } as unknown as D1Database,
    };
    const failed = await dispatchMcp(call('probe_read'), bindings);
    expect(await failed.text()).not.toContain('PRIVATE');
  });
});
