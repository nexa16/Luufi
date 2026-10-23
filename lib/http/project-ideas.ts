import { siteIdentity } from '@/lib/auth/site';
import { ProjectIdeaError } from '@/lib/services/project-ideas';

const noStore = { 'Cache-Control': 'no-store' };
export function ideaJson(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: noStore });
}

export function ideaError(error: unknown): Response {
  return error instanceof ProjectIdeaError
    ? ideaJson({ error: error.message, code: error.code }, error.status)
    : ideaJson(
        {
          error:
            'Die Projektideen sind vorübergehend nicht verfügbar. Bitte versuche es erneut.',
          code: 'unavailable',
        },
        503,
      );
}

export function ideaActor(request: Request, mutation = false): string {
  const actor = siteIdentity(request);
  if (!actor)
    throw new ProjectIdeaError(
      'unauthorized',
      'Bitte melde dich bei Luufi an.',
    );
  if (mutation) {
    const origin = request.headers.get('origin');
    if (origin !== new URL(request.url).origin) {
      throw new ProjectIdeaError(
        'forbidden',
        'Diese Anfrage stammt nicht von Luufi.',
      );
    }
  }
  return actor;
}

export async function ideaBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const invalid = () =>
    new ProjectIdeaError(
      'validation',
      'Die Anfrage muss gültige JSON-Daten mit höchstens 32 KiB enthalten.',
    );
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > 32768))
    throw invalid();
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
    'application/json'
  )
    throw invalid();
  const reader = request.body?.getReader();
  if (!reader) throw invalid();
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 32768) {
        await reader.cancel();
        throw invalid();
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw invalid();
    return value as Record<string, unknown>;
  } catch {
    throw invalid();
  } finally {
    reader.releaseLock();
  }
}
