import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { registerProject } from '@/lib/services/projects';
import {
  GET,
  PUT,
} from '@/app/api/projects/[projectId]/feedback/[feedbackId]/attachments/[attachmentId]/route';
const png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  ),
  (c) => c.charCodeAt(0),
);
async function setup() {
  const p = await registerProject(
    'owner',
    { key: 'ROUTE', name: 'Media HTTP', repository: 'example/media' },
    crypto.randomUUID(),
  );
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO feedback_threads(id,project_id,created_at,updated_at) VALUES(?,?,?,?)',
    ).bind('f', p.id, now, now),
    env.DB.prepare(
      "INSERT INTO feedback_entries(id,feedback_id,kind,text,position,created_at) VALUES('e','f','original','',0,?)",
    ).bind(now),
    env.DB.prepare(
      "INSERT INTO feedback_attachments(id,project_id,feedback_id,entry_id,filename,declared_mime_type,declared_size,position,created_at) VALUES('a',?,'f','e',?,'image/png',?,0,?)",
    ).bind(p.id, 'Bild ä.png', png.length, now),
  ]);
  return {
    params: Promise.resolve({
      projectId: p.id,
      feedbackId: 'f',
      attachmentId: 'a',
    }),
  };
}
const request = (
  method: string,
  headers: Record<string, string> = {},
  body?: Uint8Array,
) =>
  new Request('https://luufi.test/api/media', {
    method,
    headers: { 'oai-authenticated-user-id': 'owner', ...headers },
    body: body as BodyInit | undefined,
  });
const uploadHeaders = {
  origin: 'https://luufi.test',
  'content-type': 'image/png',
  'x-luufi-revision': '0',
  'x-luufi-request-key': 'upload',
};
afterEach(async () => {
  for (const table of [
    'feedback_attachments',
    'feedback_entries',
    'feedback_threads',
    'planning_requests',
    'planning_projects',
  ])
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  const objects = await env.BUCKET.list();
  for (const object of objects.objects) await env.BUCKET.delete(object.key);
});
describe('LUUFI-11 protected media HTTP', () => {
  it('uploads bounded content, streams protected files and safe download/range headers', async () => {
    const ctx = await setup();
    expect((await PUT(request('PUT', uploadHeaders, png), ctx)).status).toBe(
      200,
    );
    const full = await GET(request('GET'), ctx);
    expect(full.status).toBe(200);
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(png);
    expect(full.headers.get('cache-control')).toContain('no-store');
    expect(full.headers.get('x-content-type-options')).toBe('nosniff');
    expect(full.headers.get('content-type')).toBe('image/png');
    const part = await GET(request('GET', { range: 'bytes=2-7' }), ctx);
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 2-7/${png.length}`);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(png.slice(2, 8));
    const suffix = await GET(request('GET', { range: 'bytes=-3' }), ctx);
    expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(png.slice(-3));
    const download = await GET(
      new Request('https://luufi.test/api/media?download=1', {
        headers: { 'oai-authenticated-user-id': 'owner' },
      }),
      ctx,
    );
    expect(download.headers.get('content-disposition')).toContain(
      'attachment; filename="download"; filename*=UTF-8\'\'Bild%20%C3%A4.png',
    );
    await download.arrayBuffer();
  });
  it('denies absent identity, wrong Origin/type/revision, oversized streams and invalid ranges', async () => {
    const ctx = await setup();
    expect(
      (await GET(new Request('https://luufi.test/api/media'), ctx)).status,
    ).toBe(401);
    expect(
      (
        await PUT(
          request(
            'PUT',
            { ...uploadHeaders, origin: 'https://evil.test' },
            png,
          ),
          ctx,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await PUT(
          request(
            'PUT',
            { ...uploadHeaders, 'content-type': 'text/html' },
            png,
          ),
          ctx,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await PUT(
          request('PUT', { ...uploadHeaders, 'x-luufi-revision': 'NaN' }, png),
          ctx,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await PUT(
          request('PUT', uploadHeaders, new Uint8Array(png.length + 1)),
          ctx,
        )
      ).status,
    ).toBe(400);
    expect((await GET(request('GET'), ctx)).status).toBe(409);
    expect((await PUT(request('PUT', uploadHeaders, png), ctx)).status).toBe(
      200,
    );
    for (const range of [
      'bytes=0-1,3-4',
      'bytes=999-',
      'bytes=3-2',
      'bytes=-0',
      'other=1-2',
    ]) {
      const response = await GET(request('GET', { range }), ctx);
      expect(response.status).toBe(416);
      expect(response.headers.get('content-range')).toBe(
        `bytes */${png.length}`,
      );
    }
    const other = {
      params: Promise.resolve({
        projectId: 'other',
        feedbackId: 'f',
        attachmentId: 'a',
      }),
    };
    expect((await GET(request('GET'), other)).status).toBe(404);
  });
});
