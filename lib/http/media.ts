import { siteIdentity } from '@/lib/auth/site';
import {
  attachmentObject,
  getAttachment,
  uploadAttachment,
} from '@/lib/services/media';
import { PlanningError } from '@/lib/services/planning-store';

type Params = { projectId: string; feedbackId: string; attachmentId: string };
const json = (value: unknown, status: number) =>
  Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
const failure = (error: unknown) =>
  error instanceof PlanningError
    ? json({ code: error.code, error: error.message }, error.status)
    : json(
        {
          code: 'unavailable',
          error: 'Die Datei ist vorübergehend nicht verfügbar.',
        },
        503,
      );
const actor = (request: Request) => {
  const id = siteIdentity(request);
  if (!id)
    throw new PlanningError('unauthorized', 'Bitte melde dich bei Luufi an.');
  return id;
};
export async function mediaPut(request: Request, params: Params) {
  try {
    const identity = actor(request);
    if (request.headers.get('origin') !== new URL(request.url).origin)
      return json(
        { code: 'forbidden', error: 'Diese Anfrage stammt nicht von Luufi.' },
        403,
      );
    const revision = request.headers.get('x-luufi-revision');
    if (
      !revision ||
      !/^\d+$/.test(revision) ||
      !Number.isSafeInteger(Number(revision))
    )
      throw new PlanningError(
        'validation',
        'Die erwartete Dateirevision fehlt.',
      );
    const attachment = await getAttachment(
      identity,
      params.projectId,
      params.feedbackId,
      params.attachmentId,
    );
    if (
      request.headers.get('content-type')?.trim().toLowerCase() !==
      attachment.mimeType
    )
      throw new PlanningError(
        'validation',
        'Der Dateityp passt nicht zum Anhang.',
      );
    const length = request.headers.get('content-length');
    if (
      length !== null &&
      (!/^\d+$/.test(length) || Number(length) !== attachment.size)
    )
      throw new PlanningError(
        'validation',
        'Die Dateigröße passt nicht zum Anhang.',
      );
    const reader = request.body?.getReader();
    if (!reader) throw new PlanningError('validation', 'Die Datei fehlt.');
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > attachment.size || total > 15_000_000) {
          await reader.cancel();
          throw new PlanningError('validation', 'Die Datei ist zu groß.');
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return json(
      await uploadAttachment(
        identity,
        params.projectId,
        params.feedbackId,
        params.attachmentId,
        bytes,
        Number(revision),
        request.headers.get('x-luufi-request-key') ?? '',
      ),
      200,
    );
  } catch (error) {
    return failure(error);
  }
}
export function mediaRange(
  value: string,
  size: number,
): { offset: number; length: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  let offset: number, end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) return null;
    offset = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    offset = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(end) ||
      offset >= size ||
      end < offset
    )
      return null;
    end = Math.min(end, size - 1);
  }
  return { offset, length: end - offset + 1 };
}
export async function mediaGet(request: Request, params: Params) {
  try {
    const identity = actor(request),
      attachment = await getAttachment(
        identity,
        params.projectId,
        params.feedbackId,
        params.attachmentId,
      );
    const requested = request.headers.get('range');
    let range: { offset: number; length: number } | undefined;
    if (requested) {
      const parsed = mediaRange(requested, attachment.size);
      if (!parsed)
        return new Response(null, {
          status: 416,
          headers: {
            'Content-Range': `bytes */${attachment.size}`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      range = parsed;
    }
    const { object } = await attachmentObject(
      identity,
      params.projectId,
      params.feedbackId,
      params.attachmentId,
      range,
    );
    const disposition =
      new URL(request.url).searchParams.get('download') === '1'
        ? 'attachment'
        : 'inline';
    const encoded = encodeURIComponent(attachment.name).replace(
      /['()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    const headers: Record<string, string> = {
      'Content-Type': attachment.mimeType,
      'Content-Disposition': `${disposition}; filename="download"; filename*=UTF-8''${encoded}`,
      'Content-Length': String(range?.length ?? attachment.size),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'bytes',
    };
    if (range)
      headers['Content-Range'] =
        `bytes ${range.offset}-${range.offset + range.length - 1}/${attachment.size}`;
    return new Response(object.body, { status: range ? 206 : 200, headers });
  } catch (error) {
    return failure(error);
  }
}
