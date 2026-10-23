import { siteIdentity } from '@/lib/auth/site';
import { planningJson } from './planning';
import { PlanningError } from '@/lib/services/planning-store';

export async function feedbackRequest(
  request: Request,
  run: (actor: string) => Promise<unknown>,
  status = 200,
) {
  try {
    const actor = siteIdentity(request);
    if (!actor)
      throw new PlanningError('unauthorized', 'Bitte melde dich bei Luufi an.');
    if (
      request.method !== 'GET' &&
      request.headers.get('origin') !== new URL(request.url).origin
    )
      throw new PlanningError(
        'forbidden',
        'Diese Anfrage stammt nicht von Luufi.',
      );
    return planningJson(await run(actor), status);
  } catch (error) {
    return error instanceof PlanningError
      ? planningJson({ code: error.code, error: error.message }, error.status)
      : planningJson(
          {
            code: 'unavailable',
            error: 'Feedback ist vorübergehend nicht verfügbar.',
          },
          503,
        );
  }
}

export async function feedbackBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const invalid = () =>
    new PlanningError(
      'validation',
      'Die Anfrage muss gültige JSON-Daten mit höchstens 128 KiB enthalten.',
    );
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > 131072))
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
      if (size > 131072) {
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
