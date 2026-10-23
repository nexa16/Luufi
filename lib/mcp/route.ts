import { handleMcpMessage } from './service';
import { readProbe, writeProbe } from './storage';
import { getGuideline } from './guidelines';
import { siteIdentity } from '@/lib/auth/site';
import {
  platformReadiness,
  type DeploymentIdentityBindings,
} from '@/lib/services/deployment-identity';

type ProofBindings = DeploymentIdentityBindings & { DB: D1Database };
const headers = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
};

export async function dispatchMcp(
  request: Request,
  bindings: ProofBindings,
): Promise<Response> {
  if (!['preview', 'production'].includes(bindings.LUUFI_ENVIRONMENT ?? '')) {
    return Response.json(
      { error: 'Nicht verfügbar.' },
      { status: 404, headers },
    );
  }
  if (request.method !== 'POST') {
    return Response.json(
      { error: 'Methode nicht erlaubt.' },
      { status: 405, headers: { ...headers, Allow: 'POST' } },
    );
  }
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== new URL(request.url).origin) {
    return Response.json(
      { error: 'Diese Anfrage stammt nicht von Luufi.' },
      { status: 403, headers },
    );
  }
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
    'application/json'
  ) {
    return Response.json(
      { error: 'Die Anfrage muss application/json verwenden.' },
      { status: 415, headers },
    );
  }
  // Discovery exposes static schemas only; provisioning may have no user identity.
  const contentLength = request.headers.get('content-length');
  if (
    contentLength &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > 16_384)
  ) {
    return Response.json(
      { error: 'Anfrage zu groß.' },
      { status: 413, headers },
    );
  }
  let body: unknown;
  try {
    if (!request.body) throw new Error('Empty');
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 16_384) {
        await reader.cancel();
        return Response.json(
          { error: 'Anfrage zu groß.' },
          { status: 413, headers },
        );
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return Response.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Ungültiges JSON.' },
      },
      { status: 400, headers },
    );
  }
  const envelope = object(body);
  const method = envelope?.method;
  const params = object(envelope?.params);
  const metadata = object(params?._meta);
  const version = metadata?.['io.modelcontextprotocol/protocolVersion'];
  const mirrorFields = [
    ['Mcp-Method', method],
    ['Mcp-Name', params?.name],
    ['MCP-Protocol-Version', version],
  ] as const;
  // Legacy clients may omit mirror headers. Present headers must always match
  // the body so a gateway cannot classify a mutation as a read-only request.
  for (const [header, value] of mirrorFields) {
    if (request.headers.has(header) && request.headers.get(header) !== value) {
      return transportError(
        envelope?.id,
        -32020,
        'MCP-Header und Anfrage stimmen nicht überein.',
      );
    }
  }
  if (version !== undefined && version !== '2026-07-28') {
    return transportError(
      envelope?.id,
      -32022,
      'Diese MCP-Protokollversion wird nicht unterstützt.',
    );
  }
  const isDiscovery = [
    'server/discover',
    'initialize',
    'tools/list',
    'notifications/initialized',
  ].includes(String(method));
  const ownerId = siteIdentity(request);
  if (!isDiscovery && !ownerId) {
    return Response.json(
      { error: 'Anmeldung erforderlich.' },
      { status: 401, headers },
    );
  }
  try {
    const result = await handleMcpMessage(body, {
      environment: bindings.LUUFI_ENVIRONMENT!,
      ownerId: ownerId ?? '',
      getContext: () => platformReadiness(bindings),
      readProbe: () => readProbe(bindings.DB, ownerId!),
      writeProbe: (input) => writeProbe(bindings.DB, ownerId!, input),
      getGuideline,
    });
    return result === null
      ? new Response(null, { status: 204, headers })
      : Response.json(result, { headers });
  } catch {
    return Response.json(
      { error: 'MCP vorübergehend nicht verfügbar.' },
      { status: 503, headers },
    );
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function transportError(id: unknown, code: number, message: string) {
  const validId =
    typeof id === 'string' ||
    (typeof id === 'number' && Number.isSafeInteger(id));
  return Response.json(
    {
      jsonrpc: '2.0',
      id: validId ? id : null,
      error: {
        code,
        message,
        ...(code === -32022
          ? { data: { supportedVersions: ['2026-07-28'] } }
          : {}),
      },
    },
    { status: 400, headers },
  );
}
