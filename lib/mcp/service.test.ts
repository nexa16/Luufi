import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { handleMcpMessage, type McpDependencies } from './service';

function dependencies(): McpDependencies {
  return {
    environment: 'preview',
    ownerId: 'synthetic-owner',
    getContext: vi.fn().mockResolvedValue({ status: 'ok' }),
    readProbe: vi.fn().mockResolvedValue({ revision: 2, value: 'fixture' }),
    writeProbe: vi.fn().mockResolvedValue({
      revision: 3,
      value: 'changed',
      replayed: false,
    }),
    getGuideline: vi.fn().mockResolvedValue({
      id: 'documentation',
      version: '1.0.0',
      content: '# Synthetic guideline',
      sha256: '0'.repeat(64),
    }),
  };
}

function request(method: string, params?: unknown) {
  return {
    jsonrpc: '2.0',
    id: 7,
    method,
    ...(params === undefined ? {} : { params }),
  };
}

async function call(name: string, args: unknown, deps = dependencies()) {
  return (await handleMcpMessage(
    request('tools/call', { name, arguments: args }),
    deps,
  )) as {
    result: { content: { type: string; text: string }[]; isError?: boolean };
  };
}

function expectNoIO(deps: McpDependencies) {
  expect(deps.readProbe).not.toHaveBeenCalled();
  expect(deps.writeProbe).not.toHaveBeenCalled();
  expect(deps.getGuideline).not.toHaveBeenCalled();
  expect(deps.getContext).not.toHaveBeenCalled();
}

describe('MCP proof JSON-RPC boundary', () => {
  it.each([
    null,
    [],
    7,
    {},
    { jsonrpc: '1.0', id: 7, method: 'tools/list' },
    { jsonrpc: '2.0', id: 7 },
    { jsonrpc: '2.0', id: {}, method: 'tools/list' },
    { jsonrpc: '2.0', id: Infinity, method: 'tools/list' },
    { jsonrpc: '2.0', id: null, method: 'tools/list' },
    { jsonrpc: '2.0', id: 1.5, method: 'tools/list' },
    { ...request('tools/list'), extra: 'forbidden' },
  ])('rejects malformed envelope without I/O: %j', async (message) => {
    const deps = dependencies();
    expect(await handleMcpMessage(message, deps)).toMatchObject({
      error: { code: -32600 },
    });
    expectNoIO(deps);
  });

  it('reports unknown methods and malformed parameters', async () => {
    const deps = dependencies();
    expect(await handleMcpMessage(request('unknown'), deps)).toMatchObject({
      id: 7,
      error: { code: -32601 },
    });
    for (const params of [null, [], 7, 'wrong']) {
      expect(
        await handleMcpMessage(request('tools/list', params), deps),
      ).toMatchObject({
        error: { code: -32602 },
      });
    }
    expectNoIO(deps);
  });

  it('discovers current protocol and supports initialize', async () => {
    const deps = dependencies();
    expect(
      await handleMcpMessage(request('server/discover'), deps),
    ).toMatchObject({
      jsonrpc: '2.0',
      id: 7,
      result: {
        supportedVersions: ['2026-07-28'],
        capabilities: { tools: {} },
      },
    });
    expect(
      await handleMcpMessage(request('initialize', {}), deps),
    ).toMatchObject({
      result: { protocolVersion: '2026-07-28' },
    });
    expectNoIO(deps);
  });

  it('preserves valid string and integer IDs', async () => {
    const deps = dependencies();
    for (const id of ['caller-id', 0]) {
      expect(
        await handleMcpMessage({ ...request('tools/list'), id }, deps),
      ).toMatchObject({ id });
    }
  });

  it('lists complete bounded schemas and read-only annotations', async () => {
    const response = (await handleMcpMessage(
      request('tools/list'),
      dependencies(),
    )) as {
      result: {
        tools: { name: string; inputSchema: unknown; annotations: unknown }[];
      };
    };
    expect(response.result.tools.map((tool) => tool.name)).toEqual([
      'get_context',
      'probe_read',
      'probe_write',
      'get_guidelines',
      'read_probe_attachment',
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
    ]);
    expect(
      response.result.tools.find((tool) => tool.name === 'probe_write'),
    ).toMatchObject({
      inputSchema: {
        required: ['expectedRevision', 'value', 'requestKey'],
        additionalProperties: false,
        properties: {
          value: { maxLength: 1000 },
          requestKey: { minLength: 1, maxLength: 100 },
        },
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    });
    expect(
      response.result.tools.find((tool) => tool.name === 'get_guidelines'),
    ).toMatchObject({
      inputSchema: {
        properties: {
          id: {
            enum: [
              'documentation',
              'planning',
              'implementation',
              'data-access',
            ],
          },
        },
      },
    });
  });

  it('does not mutate or respond to notifications', async () => {
    const deps = dependencies();
    for (const method of [
      'notifications/initialized',
      'tools/call',
      'unknown',
    ]) {
      expect(
        await handleMcpMessage(
          {
            jsonrpc: '2.0',
            method,
            params: {
              name: 'probe_write',
              arguments: { expectedRevision: 0, value: 'no', requestKey: 'no' },
            },
          },
          deps,
        ),
      ).toBeNull();
    }
    expectNoIO(deps);
  });

  it.each([
    {},
    { name: 3, arguments: {} },
    { name: 'probe_read', arguments: null },
    { name: 'probe_read', arguments: [] },
    { name: 'probe_read', arguments: {}, _meta: null },
    { name: 'probe_read', arguments: {}, _meta: [] },
    { name: 'probe_read', arguments: {}, _meta: 'invalid' },
    { name: 'probe_read', arguments: {}, ownerId: 'forbidden' },
  ])(
    'rejects malformed tools/call parameters without I/O: %j',
    async (params) => {
      const deps = dependencies();
      expect(
        await handleMcpMessage(request('tools/call', params), deps),
      ).toMatchObject({ error: { code: -32602 } });
      expectNoIO(deps);
    },
  );
});

describe('MCP proof tool contracts', () => {
  it.each(['probe_write', 'get_guidelines'])(
    'LUUFI-1 keeps required arguments mandatory for %s',
    async (name) => {
      const deps = dependencies();
      expect(
        await handleMcpMessage(
          request('tools/call', { name, _meta: {} }),
          deps,
        ),
      ).toMatchObject({ result: { resultType: 'complete', isError: true } });
      expectNoIO(deps);
    },
  );

  it('LUUFI-1 permits omitted attachment arguments', async () => {
    expect(
      await handleMcpMessage(
        request('tools/call', {
          name: 'read_probe_attachment',
          _meta: {},
        }),
        dependencies(),
      ),
    ).toMatchObject({
      result: { resultType: 'complete', content: [{ type: 'text' }] },
    });
  });

  it.each([undefined, {}])(
    'LUUFI-1 accepts native request metadata with optional empty arguments: %j',
    async (args) => {
      const deps = dependencies();
      const response = await handleMcpMessage(
        request('tools/call', {
          name: 'probe_read',
          ...(args === undefined ? {} : { arguments: args }),
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'openai/locale': 'de-AT',
            'openai/subject': 'untrusted-metadata-owner',
          },
        }),
        deps,
      );
      expect(response).toMatchObject({
        result: {
          resultType: 'complete',
          content: [
            {
              type: 'text',
              text: JSON.stringify({ revision: 2, value: 'fixture' }),
            },
          ],
        },
      });
      expect(deps.readProbe).toHaveBeenCalledExactlyOnceWith();
      expect(deps.ownerId).toBe('synthetic-owner');
    },
  );

  it('LUUFI-1 ignores metadata identity and passes only validated write arguments', async () => {
    const deps = dependencies();
    const args = {
      expectedRevision: 2,
      value: 'changed',
      requestKey: 'native',
    };
    expect(
      await handleMcpMessage(
        request('tools/call', {
          name: 'probe_write',
          arguments: args,
          _meta: { ownerId: 'forged-owner', 'openai/subject': 'forged-owner' },
        }),
        deps,
      ),
    ).toMatchObject({ result: { content: [{ type: 'text' }] } });
    expect(deps.writeProbe).toHaveBeenCalledExactlyOnceWith(args);
    expect(deps.ownerId).toBe('synthetic-owner');
  });

  it('reads the isolated probe and represents an absent probe', async () => {
    const deps = dependencies();
    expect(
      JSON.parse((await call('probe_read', {}, deps)).result.content[0].text),
    ).toEqual({ revision: 2, value: 'fixture' });
    vi.mocked(deps.readProbe).mockResolvedValue(null);
    expect(
      JSON.parse((await call('probe_read', {}, deps)).result.content[0].text),
    ).toBeNull();
    expect(deps.writeProbe).not.toHaveBeenCalled();
  });

  it('writes exactly the validated input and returns adapter replay evidence', async () => {
    const deps = dependencies();
    const args = {
      expectedRevision: 0,
      value: 'changed',
      requestKey: 'synthetic-key',
    };
    expect(
      JSON.parse(
        (await call('probe_write', args, deps)).result.content[0].text,
      ),
    ).toEqual({ revision: 3, value: 'changed', replayed: false });
    expect(deps.writeProbe).toHaveBeenCalledExactlyOnceWith(args);
    vi.mocked(deps.writeProbe).mockResolvedValue({
      revision: 3,
      value: 'changed',
      replayed: true,
    });
    expect(
      JSON.parse((await call('probe_write', args, deps)).result.content[0].text)
        .replayed,
    ).toBe(true);
  });

  it('accepts documented boundaries including unicode code points', async () => {
    const deps = dependencies();
    for (const args of [
      { expectedRevision: 0, value: '', requestKey: 'a' },
      {
        expectedRevision: Number.MAX_SAFE_INTEGER,
        value: '😀'.repeat(1000),
        requestKey: 'x'.repeat(100),
      },
    ]) {
      expect(
        (await call('probe_write', args, deps)).result.isError,
      ).toBeUndefined();
    }
  });

  it.each([
    {},
    { expectedRevision: -1, value: 'x', requestKey: 'k' },
    { expectedRevision: 1.5, value: 'x', requestKey: 'k' },
    { expectedRevision: '0', value: 'x', requestKey: 'k' },
    {
      expectedRevision: Number.MAX_SAFE_INTEGER + 1,
      value: 'x',
      requestKey: 'k',
    },
    { expectedRevision: 0, value: 5, requestKey: 'k' },
    { expectedRevision: 0, value: 'x'.repeat(1001), requestKey: 'k' },
    { expectedRevision: 0, value: 'x', requestKey: '' },
    { expectedRevision: 0, value: 'x', requestKey: 'x'.repeat(101) },
    { expectedRevision: 0, value: 'x', requestKey: 1 },
    {
      expectedRevision: 0,
      value: 'x',
      requestKey: 'k',
      ownerId: 'another-owner',
    },
    { expectedRevision: 0, value: 'x', requestKey: 'k', sql: 'DROP TABLE' },
  ])('rejects invalid or forbidden mutations before I/O: %j', async (args) => {
    const deps = dependencies();
    expect((await call('probe_write', args, deps)).result.isError).toBe(true);
    expectNoIO(deps);
  });

  it.each([
    ['probe_read', { ownerId: 'other' }],
    ['read_probe_attachment', { path: '/private' }],
    ['get_guidelines', {}],
    ['get_guidelines', { id: '../secret' }],
    ['get_guidelines', { id: 'documentation', version: 'injected' }],
    ['unknown', {}],
  ])('rejects forbidden tool arguments without I/O: %s', async (name, args) => {
    const deps = dependencies();
    expect((await call(name, args, deps)).result.isError).toBe(true);
    expectNoIO(deps);
  });

  it('denies empty caller identity without I/O', async () => {
    const deps = { ...dependencies(), ownerId: '  ' };
    expect((await call('probe_read', {}, deps)).result.isError).toBe(true);
    expectNoIO(deps);
  });

  it.each(['documentation', 'planning', 'implementation', 'data-access'])(
    'loads allowed guideline %s',
    async (id) => {
      const deps = dependencies();
      const response = await call('get_guidelines', { id }, deps);
      expect(deps.getGuideline).toHaveBeenCalledExactlyOnceWith(id);
      expect(JSON.parse(response.result.content[0].text)).toMatchObject({
        version: '1.0.0',
        content: '# Synthetic guideline',
      });
    },
  );

  it('returns deterministic synthetic attachment with valid hash and encoding', async () => {
    const response = await call('read_probe_attachment', {});
    const file = JSON.parse(response.result.content[0].text);
    const bytes = Buffer.from(file.base64, 'base64');
    expect(file).toMatchObject({
      filename: 'luufi-mcp-proof.txt',
      mimeType: 'text/plain',
      byteLength: bytes.byteLength,
    });
    expect(bytes.toString('utf8')).toBe(
      'Luufi MCP proof attachment.\nNo personal data.\n',
    );
    expect(file.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect((await call('read_probe_attachment', {})).result).toEqual(
      response.result,
    );
  });

  it.each([
    [
      Object.assign(new Error('secret-token PRIVATE stack'), {
        code: 'REVISION_CONFLICT',
      }),
      'Versionskonflikt',
    ],
    [
      Object.assign(new Error('secret-token PRIVATE stack'), {
        code: 'REQUEST_KEY_CONFLICT',
      }),
      'Wiederholungsschlüssel',
    ],
    [new Error('secret-token PRIVATE stack'), 'Werkzeug konnte nicht'],
    ['secret-token PRIVATE stack', 'Werkzeug konnte nicht'],
    [null, 'Werkzeug konnte nicht'],
  ])('sanitizes adapter errors: %s', async (error, expected) => {
    const deps = dependencies();
    vi.mocked(deps.writeProbe).mockRejectedValue(error);
    const response = await call(
      'probe_write',
      { expectedRevision: 0, value: 'x', requestKey: 'k' },
      deps,
    );
    expect(response.result.isError).toBe(true);
    expect(response.result.content[0].text).toContain(expected);
    expect(JSON.stringify(response)).not.toMatch(/secret-token|PRIVATE|stack/);
  });
});
