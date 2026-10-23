import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerProject } from '@/lib/services/projects';
import {
  cleanupAttachments,
  getAttachment,
  readAttachment,
  uploadAttachment,
} from '@/lib/services/media';
const png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  ),
  (c) => c.charCodeAt(0),
);
async function seed() {
  const p = await registerProject(
    'owner',
    { key: 'MEDIA', name: 'Medien', repository: 'example/media' },
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
      "INSERT INTO feedback_attachments(id,project_id,feedback_id,entry_id,filename,declared_mime_type,declared_size,position,created_at) VALUES('a',?,'f','e','Bild.png','image/png',?,0,?)",
    ).bind(p.id, png.length, now),
  ]);
  return p.id;
}
afterEach(async () => {
  await env.DB.prepare('DROP TRIGGER IF EXISTS fail_media').run();
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
describe('LUUFI-11 private D1/R2 media', () => {
  it('atomically publishes immutable bytes, bounded chunks and original replay', async () => {
    const p = await seed();
    const saved = await uploadAttachment(
      'owner',
      p,
      'f',
      'a',
      png,
      0,
      'upload',
    );
    expect(saved).toMatchObject({
      status: 'ready',
      revision: 1,
      size: png.length,
    });
    expect(JSON.stringify(saved)).not.toContain('feedback-media/');
    expect(
      await uploadAttachment('owner', p, 'f', 'a', png, 0, 'upload'),
    ).toEqual(saved);
    const chunk = await readAttachment('owner', p, 'f', 'a', 2, 65536);
    expect(atob(chunk.base64).length).toBe(png.length - 2);
    expect(chunk.sha256).toBe(saved.sha256);
    expect(
      await env.DB.prepare(
        "SELECT revision,content_revision FROM feedback_threads WHERE id='f'",
      ).first(),
    ).toEqual({ revision: 1, content_revision: 1 });
    await expect(
      uploadAttachment('owner', p, 'f', 'a', png, 1, 'replace'),
    ).rejects.toMatchObject({ code: 'conflict' });
    const changed = png.slice();
    changed[1] ^= 1;
    await expect(
      uploadAttachment('owner', p, 'f', 'a', changed, 0, 'upload'),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      readAttachment('owner', p, 'f', 'a', 0, 65537),
    ).rejects.toMatchObject({ code: 'validation' });
  });
  it('rejects unauthorized, cross-project, incomplete and mismatched uploads', async () => {
    const p = await seed();
    await expect(getAttachment('', p, 'f', 'a')).rejects.toMatchObject({
      code: 'unauthorized',
    });
    await expect(
      getAttachment('owner', 'elsewhere', 'f', 'a'),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      readAttachment('owner', p, 'f', 'a', 0, 1),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      uploadAttachment(
        'owner',
        p,
        'f',
        'a',
        new Uint8Array(png.length),
        0,
        'bad',
      ),
    ).rejects.toMatchObject({ code: 'validation' });
    expect((await env.BUCKET.list()).objects).toHaveLength(0);
  });
  it('keeps one object for concurrent identical attempts and a single winner for competing keys', async () => {
    const p = await seed();
    const results = await Promise.all(
      [1, 2].map(() => uploadAttachment('owner', p, 'f', 'a', png, 0, 'same')),
    );
    expect(results[0]).toEqual(results[1]);
    expect((await env.BUCKET.list()).objects).toHaveLength(1);
  });
  it('removes the losing object for distinct concurrent upload keys', async () => {
    const p = await seed();
    const results = await Promise.allSettled(
      ['one', 'two'].map((key) =>
        uploadAttachment('owner', p, 'f', 'a', png, 0, key),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await env.BUCKET.list()).objects).toHaveLength(1);
    expect(
      await env.DB.prepare(
        "SELECT content_revision FROM feedback_threads WHERE id='f'",
      ).first(),
    ).toEqual({ content_revision: 1 });
  });
  it('does not publish interrupted R2 writes and safely retries the unchanged slot', async () => {
    const p = await seed();
    const put = env.BUCKET.put.bind(env.BUCKET);
    vi.spyOn(env.BUCKET, 'put').mockImplementationOnce(
      async (...args: Parameters<typeof put>) => {
        await put(...args);
        throw new Error('synthetic interrupted response');
      },
    );
    await expect(
      uploadAttachment('owner', p, 'f', 'a', png, 0, 'interrupted'),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect((await getAttachment('owner', p, 'f', 'a')).status).toBe('pending');
    expect((await env.BUCKET.list()).objects).toHaveLength(0);
    expect(
      (await uploadAttachment('owner', p, 'f', 'a', png, 0, 'interrupted'))
        .status,
    ).toBe('ready');
  });
  it('rolls back D1 failures and removes its attempted object', async () => {
    const p = await seed();
    await env.DB.prepare(
      "CREATE TRIGGER fail_media BEFORE UPDATE ON planning_requests WHEN NEW.operation='media.upload' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
    ).run();
    await expect(
      uploadAttachment('owner', p, 'f', 'a', png, 0, 'fail'),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect((await getAttachment('owner', p, 'f', 'a')).status).toBe('pending');
    expect((await env.BUCKET.list()).objects).toHaveLength(0);
  });
  it('expires old pending slots without content changes; refreshed retries remain possible', async () => {
    const p = await seed();
    await env.DB.prepare(
      "UPDATE feedback_attachments SET created_at='2000-01-01T00:00:00.000Z'",
    ).run();
    expect(await cleanupAttachments('owner', 1, 'cleanup')).toEqual({
      expired: 1,
      deletedOrphans: 0,
    });
    expect(await cleanupAttachments('owner', 1, 'cleanup')).toEqual({
      expired: 1,
      deletedOrphans: 0,
    });
    expect(await getAttachment('owner', p, 'f', 'a')).toMatchObject({
      status: 'expired',
      revision: 1,
    });
    expect(
      await env.DB.prepare(
        "SELECT revision,content_revision FROM feedback_threads WHERE id='f'",
      ).first(),
    ).toEqual({ revision: 1, content_revision: 0 });
    await uploadAttachment('owner', p, 'f', 'a', png, 1, 'retry');
    expect((await getAttachment('owner', p, 'f', 'a')).status).toBe('ready');
  });
  it('cleans only old unreferenced objects, persists retry plan, preserves ready references', async () => {
    const p = await seed();
    await uploadAttachment('owner', p, 'f', 'a', png, 0, 'save');
    await env.BUCKET.put('feedback-media/old/orphan', png);
    const future = Date.now() + 86_400_001;
    vi.spyOn(Date, 'now').mockReturnValue(future);
    expect(await cleanupAttachments('owner', 50, 'sweep')).toEqual({
      expired: 0,
      deletedOrphans: 1,
    });
    expect(await env.BUCKET.get('feedback-media/old/orphan')).toBeNull();
    expect((await env.BUCKET.list()).objects).toHaveLength(1);
    expect(await cleanupAttachments('owner', 50, 'sweep')).toEqual({
      expired: 0,
      deletedOrphans: 1,
    });
    await expect(
      cleanupAttachments('owner', 51, 'bad-limit'),
    ).rejects.toMatchObject({ code: 'validation' });
  });
  it('resumes a failed deletion from the durable receipt and keeps bounded scan progress', async () => {
    await seed();
    await env.BUCKET.put('feedback-media/old/a', png);
    await env.BUCKET.put('feedback-media/old/b', png);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 86_400_001);
    const deletion = vi
      .spyOn(env.BUCKET, 'delete')
      .mockRejectedValueOnce(new Error('synthetic failure'));
    await expect(
      cleanupAttachments('owner', 1, 'first-scan'),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect(await cleanupAttachments('owner', 1, 'first-scan')).toEqual({
      expired: 1,
      deletedOrphans: 1,
    });
    expect(await cleanupAttachments('owner', 1, 'second-scan')).toEqual({
      expired: 0,
      deletedOrphans: 1,
    });
    expect((await env.BUCKET.list()).objects).toHaveLength(0);
    expect(deletion).toHaveBeenCalledTimes(3);
  });
});
