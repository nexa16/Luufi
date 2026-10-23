import { env } from 'cloudflare:workers';
import { afterEach, expect, it, vi } from 'vitest';
import {
  appendFeedback,
  createFeedback,
  getFeedback,
  listFeedback,
  listFeedbackEntries,
  listFeedbackRefinements,
  listOrderFeedbackSources,
  refineFeedback,
} from '@/lib/services/feedback';
import { registerProject } from '@/lib/services/projects';
import { createOrder } from '@/lib/services/orders';
import type { FeedbackInput, RefinementInput } from '@/lib/domain/feedback';

const actor = 'synthetic-owner';
const key = () => crypto.randomUUID();
const project = async () =>
  (
    await registerProject(
      actor,
      {
        key: `P${key().replaceAll('-', '').slice(0, 15).toUpperCase()}`,
        name: 'Synthetisches Projekt',
        repository: 'example/synthetic',
      },
      key(),
    )
  ).id;
const order = async (projectId: string) =>
  (
    await createOrder(
      actor,
      projectId,
      {
        type: 'feature',
        spec: { title: 'Quellauftrag', goal: 'Ziel', origin: 'Test' },
      },
      key(),
    )
  ).id;
const manifest = {
  name: 'Bild.png',
  mimeType: 'image/png' as const,
  size: 100,
};
const refinement = (
  overrides: Partial<RefinementInput> = {},
): RefinementInput => ({
  repositoryCommit: 'abcdef0123456789abcdef0123456789abcdef01',
  documentationPolicy: '1.0.0',
  planningPolicy: '1.0.0',
  summary: 'Ergebnis',
  questions: ['Welche Variante wird gewünscht?'],
  ...overrides,
});
async function counts() {
  const tables = [
    'feedback_threads',
    'feedback_entries',
    'feedback_attachments',
    'feedback_refinements',
    'feedback_order_sources',
    'planning_requests',
  ];
  return Promise.all(
    tables.map((table) =>
      env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{
        n: number;
      }>(),
    ),
  );
}
afterEach(async () => {
  vi.restoreAllMocks();
  await env.DB.prepare('DROP TRIGGER IF EXISTS reject_feedback_receipt').run();
  await env.DB.batch(
    [
      'feedback_order_sources',
      'feedback_refinements',
      'feedback_attachments',
      'feedback_entries',
      'feedback_threads',
      'planning_order_relations',
      'planning_order_versions',
      'planning_orders',
      'planning_milestones',
      'planning_requests',
      'planning_projects',
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  );
});

it('bewahrt Originaltext und Ergänzungen exakt, mit Daten und stabiler Reihenfolge', async () => {
  const p = await project(),
    text = '  Erster\r\nText 👩‍💻\n\t ';
  const first = await createFeedback(
    actor,
    p,
    { text, attachments: [manifest] },
    'original',
  );
  expect(first.feedback).toMatchObject({
    revision: 0,
    contentRevision: 0,
    refinedContentRevision: null,
    needsRefinement: true,
  });
  expect(first.entry).toMatchObject({
    text,
    kind: 'original',
    position: 0,
    createdAt: expect.any(String),
  });
  expect(first.entry.attachments).toMatchObject([
    {
      ...manifest,
      status: 'pending',
      revision: 0,
      sha256: null,
      readyAt: null,
    },
  ]);
  expect(first.entry.attachments[0].mediaUrl).toBe(
    `/api/projects/${p}/feedback/${first.feedback.id}/attachments/${first.entry.attachments[0].id}`,
  );
  expect(first.entry.attachments[0].downloadUrl).toBe(
    `${first.entry.attachments[0].mediaUrl}?download=1`,
  );
  expect(first.entry.attachments[0]).not.toHaveProperty('objectKey');
  const second = await appendFeedback(
    actor,
    p,
    first.feedback.id,
    { text: '\n Ergänzung \n' },
    0,
    'addition',
  );
  expect(second.feedback).toMatchObject({
    revision: 1,
    contentRevision: 1,
    needsRefinement: true,
  });
  expect(second.entry).toMatchObject({
    kind: 'addition',
    position: 1,
    text: '\n Ergänzung \n',
  });
  expect(
    (await listFeedbackEntries(actor, p, first.feedback.id)).items,
  ).toEqual([first.entry, second.entry]);
  expect((await listFeedback(actor, p)).items).toMatchObject([
    {
      originalPreview: text,
      entryCount: 2,
      attachmentCount: 1,
      pendingAttachmentCount: 1,
    },
  ]);
  expect((await listFeedback(actor, p)).items[0]).not.toHaveProperty('entries');
  expect(
    await createFeedback(
      actor,
      p,
      { text, attachments: [manifest] },
      'original',
    ),
  ).toEqual(first);
  expect(
    await appendFeedback(
      actor,
      p,
      first.feedback.id,
      { text: '\n Ergänzung \n' },
      0,
      'addition',
    ),
  ).toEqual(second);
});

it('erlaubt Medien ohne Text und zehn eigene Slots pro Eintrag, ohne Inhalte anderer Einträge zu ersetzen', async () => {
  const p = await project(),
    attachments = Array.from({ length: 10 }, (_, i) => ({
      ...manifest,
      name: `${i}.png`,
    }));
  const a = await createFeedback(actor, p, { text: '\t ', attachments }, key());
  const b = await appendFeedback(
    actor,
    p,
    a.feedback.id,
    { text: '', attachments },
    0,
    key(),
  );
  expect(a.entry.attachments.map((item) => item.name)).toEqual(
    attachments.map((item) => item.name),
  );
  expect(b.entry.attachments).toHaveLength(10);
  expect((await listFeedbackEntries(actor, p, a.feedback.id)).items[0]).toEqual(
    a.entry,
  );
});

it('akzeptiert die genauen Text- und Mediengrenzen ohne Unicode-Normalisierung', async () => {
  const p = await project(),
    text = '😀'.repeat(10_000);
  const saved = await createFeedback(
    actor,
    p,
    {
      text,
      attachments: [
        { name: 'Foto.jpg', mimeType: 'image/jpeg', size: 10_000_000 },
        { name: 'Clip.mov', mimeType: 'video/quicktime', size: 15_000_000 },
        { name: 'Clip.webm', mimeType: 'video/webm', size: 1 },
        { name: 'Foto.webp', mimeType: 'image/webp', size: 1 },
        { name: 'Clip.mp4', mimeType: 'video/mp4', size: 1 },
      ],
    },
    key(),
  );
  expect(saved.entry.text).toBe(text);
  expect(saved.entry.attachments.map((a) => a.size)).toEqual([
    10_000_000, 15_000_000, 1, 1, 1,
  ]);
  await expect(
    appendFeedback(actor, p, saved.feedback.id, { text: `${text}x` }, 0, key()),
  ).rejects.toMatchObject({ code: 'validation' });
});

it('trennt Refinement von Inhalt und verknüpft viele Feedbacks mit vielen vorhandenen Aufträgen', async () => {
  const p = await project(),
    a = await order(p),
    b = await order(p);
  const first = await createFeedback(actor, p, { text: 'Original' }, key());
  const second = await createFeedback(
    actor,
    p,
    { text: 'Weiterer Ursprung' },
    key(),
  );
  const input = refinement({
    orderIds: [b, a, a],
    deferredReason: 'Teil erst später',
    rejectedReason: 'Andere Variante ausgeschlossen',
  });
  const refined = await refineFeedback(
    actor,
    p,
    first.feedback.id,
    input,
    0,
    'refine',
  );
  expect(refined).toMatchObject({
    revision: 1,
    contentRevision: 0,
    refinedContentRevision: 0,
    needsRefinement: false,
  });
  const records = await listFeedbackRefinements(actor, p, first.feedback.id);
  expect(records.items).toMatchObject([
    { inputContentRevision: 0, ...input, orderIds: [a, b].sort() },
  ]);
  await refineFeedback(
    actor,
    p,
    second.feedback.id,
    refinement({ orderIds: [a], questions: [] }),
    0,
    key(),
  );
  expect(
    (await listOrderFeedbackSources(actor, p, a)).items
      .map((item) => item.feedbackId)
      .sort(),
  ).toEqual([first.feedback.id, second.feedback.id].sort());
  expect((await listOrderFeedbackSources(actor, p, b)).items).toMatchObject([
    {
      feedbackId: first.feedback.id,
      refinementId: records.items[0].id,
      inputContentRevision: 0,
      summary: 'Ergebnis',
    },
  ]);
  const appended = await appendFeedback(
    actor,
    p,
    first.feedback.id,
    { text: 'Neu' },
    1,
    key(),
  );
  expect(appended.feedback).toMatchObject({
    revision: 2,
    contentRevision: 1,
    refinedContentRevision: 0,
    needsRefinement: true,
  });
  expect(
    await refineFeedback(actor, p, first.feedback.id, input, 0, 'refine'),
  ).toEqual(refined);
  expect(
    (await listFeedbackRefinements(actor, p, first.feedback.id)).items,
  ).toEqual(records.items);
});

it.each([
  { deferredReason: 'Bewusst zurückgestellt' },
  { rejectedReason: 'Nicht Teil des Produkts' },
])(
  'speichert auch begründete Entscheidungen ohne Auftragsanlage: %j',
  async (outcome) => {
    const p = await project(),
      f = await createFeedback(actor, p, { text: 'Frage' }, key());
    await refineFeedback(
      actor,
      p,
      f.feedback.id,
      refinement({ questions: [], ...outcome }),
      0,
      key(),
    );
    expect(
      (await listFeedbackRefinements(actor, p, f.feedback.id)).items,
    ).toMatchObject([{ ...outcome, orderIds: [], questions: [] }]);
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS n FROM planning_orders').first(),
    ).toEqual({ n: 0 });
  },
);

it('serialisiert parallele Ergänzungen und Refinements ohne verlorene Daten', async () => {
  const p = await project(),
    f = await createFeedback(actor, p, { text: 'Original' }, key());
  const results = await Promise.allSettled([
    appendFeedback(actor, p, f.feedback.id, { text: 'Ergänzung' }, 0, key()),
    refineFeedback(actor, p, f.feedback.id, refinement(), 0, key()),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((r) => r.status === 'rejected')).toMatchObject({
    reason: { code: 'conflict' },
  });
  expect((await getFeedback(actor, p, f.feedback.id)).revision).toBe(1);
  const entries = await listFeedbackEntries(actor, p, f.feedback.id),
    refinements = await listFeedbackRefinements(actor, p, f.feedback.id);
  expect(entries.items.length + refinements.items.length).toBe(2);
});

it('spielt parallele identische Aufrufe exakt wieder ab und bindet Schlüssel an Actor, Operation und Inhalt', async () => {
  const p = await project();
  const creates = await Promise.all([
    createFeedback(actor, p, { text: 'Einmal' }, 'same'),
    createFeedback(actor, p, { text: 'Einmal' }, 'same'),
  ]);
  expect(creates[0]).toEqual(creates[1]);
  const id = creates[0].feedback.id;
  const adds = await Promise.all([
    appendFeedback(actor, p, id, { text: 'Auch einmal' }, 0, 'add'),
    appendFeedback(actor, p, id, { text: 'Auch einmal' }, 0, 'add'),
  ]);
  expect(adds[0]).toEqual(adds[1]);
  const refined = await Promise.all([
    refineFeedback(actor, p, id, refinement(), 1, 'ref'),
    refineFeedback(actor, p, id, refinement(), 1, 'ref'),
  ]);
  expect(refined[0]).toEqual(refined[1]);
  await expect(
    createFeedback(actor, p, { text: 'Anders' }, 'same'),
  ).rejects.toMatchObject({ code: 'conflict' });
  await expect(
    createFeedback('different-owner', p, { text: 'Einmal' }, 'same'),
  ).rejects.toMatchObject({ code: 'conflict' });
  await expect(
    appendFeedback(actor, p, id, { text: 'Einmal' }, 2, 'same'),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect((await listFeedbackEntries(actor, p, id)).items).toHaveLength(2);
});

it('prüft neue Medieninhalte nach der Vorprüfung im atomaren Refinement-Guard', async () => {
  const p = await project(),
    f = await createFeedback(actor, p, { text: 'Text' }, key());
  const batch = env.DB.batch.bind(env.DB);
  vi.spyOn(env.DB, 'batch').mockImplementationOnce(async (statements) => {
    await env.DB.prepare(
      'UPDATE feedback_threads SET revision=revision+1,content_revision=content_revision+1 WHERE id=?',
    )
      .bind(f.feedback.id)
      .run();
    return batch(statements);
  });
  await expect(
    refineFeedback(actor, p, f.feedback.id, refinement(), 0, key()),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect(await getFeedback(actor, p, f.feedback.id)).toMatchObject({
    revision: 1,
    contentRevision: 1,
    refinedContentRevision: null,
    needsRefinement: true,
  });
  expect(
    (await listFeedbackRefinements(actor, p, f.feedback.id)).items,
  ).toEqual([]);
});

it('prüft Auftragsquellen nach der Vorprüfung nochmals atomar', async () => {
  const p = await project(),
    other = await project(),
    source = await order(p);
  const f = await createFeedback(actor, p, { text: 'Text' }, key());
  const batch = env.DB.batch.bind(env.DB);
  vi.spyOn(env.DB, 'batch').mockImplementationOnce(async (statements) => {
    await env.DB.prepare('UPDATE planning_orders SET project_id=? WHERE id=?')
      .bind(other, source)
      .run();
    return batch(statements);
  });
  await expect(
    refineFeedback(
      actor,
      p,
      f.feedback.id,
      refinement({ orderIds: [source] }),
      0,
      key(),
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect(await getFeedback(actor, p, f.feedback.id)).toEqual(f.feedback);
  expect(
    (await listFeedbackRefinements(actor, p, f.feedback.id)).items,
  ).toEqual([]);
});

it('sichert Projektgrenzen und fehlende Ziele einschließlich Auftrag-Quellen', async () => {
  const p = await project(),
    other = await project(),
    f = await createFeedback(actor, p, { text: 'Text' }, key());
  const foreignOrder = await order(other);
  for (const action of [
    () => getFeedback(actor, other, f.feedback.id),
    () => listFeedbackEntries(actor, other, f.feedback.id),
    () => listFeedbackRefinements(actor, other, f.feedback.id),
    () =>
      appendFeedback(actor, other, f.feedback.id, { text: 'Fremd' }, 0, key()),
    () => refineFeedback(actor, other, f.feedback.id, refinement(), 0, key()),
    () => listOrderFeedbackSources(actor, p, foreignOrder),
    () => listOrderFeedbackSources(actor, p, 'missing'),
    () => listFeedback(actor, 'missing'),
    () => createFeedback(actor, 'missing', { text: 'Text' }, key()),
  ])
    await expect(action()).rejects.toMatchObject({ code: 'not_found' });
  for (const [orderIds, code] of [
    [[foreignOrder], 'conflict'],
    [['missing'], 'not_found'],
  ] as const)
    await expect(
      refineFeedback(
        actor,
        p,
        f.feedback.id,
        refinement({ orderIds: [...orderIds] }),
        0,
        key(),
      ),
    ).rejects.toMatchObject({ code });
  expect(await getFeedback(actor, p, f.feedback.id)).toEqual(f.feedback);
});

it.each(['create', 'append', 'refine'] as const)(
  'rollt %s samt Slots, Quellen, Zähler und Receipt atomar zurück',
  async (operation) => {
    const p = await project(),
      source = await order(p),
      f = await createFeedback(actor, p, { text: 'Original' }, key());
    const before = await counts();
    await env.DB.prepare(
      "CREATE TRIGGER reject_feedback_receipt BEFORE UPDATE ON planning_requests BEGIN SELECT RAISE(ABORT,'PRIVATE FAILURE'); END",
    ).run();
    const action =
      operation === 'create'
        ? createFeedback(
            actor,
            p,
            { text: 'Neu', attachments: [manifest] },
            key(),
          )
        : operation === 'append'
          ? appendFeedback(
              actor,
              p,
              f.feedback.id,
              { text: 'Zusatz', attachments: [manifest] },
              0,
              key(),
            )
          : refineFeedback(
              actor,
              p,
              f.feedback.id,
              refinement({ orderIds: [source] }),
              0,
              key(),
            );
    await expect(action).rejects.toMatchObject({ code: 'unavailable' });
    expect(await counts()).toEqual(before);
    expect(await getFeedback(actor, p, f.feedback.id)).toEqual(f.feedback);
    expect(
      await env.DB.prepare(
        'SELECT next_entry_position FROM feedback_threads WHERE id=?',
      )
        .bind(f.feedback.id)
        .first(),
    ).toEqual({ next_entry_position: 1 });
  },
);

it('paginiert alle vier Ansichten mit projekt-/threadgebundenen invalidierbaren Cursorn', async () => {
  const p = await project(),
    source = await order(p),
    a = await createFeedback(actor, p, { text: 'A' }, key()),
    b = await createFeedback(actor, p, { text: 'B' }, key());
  await appendFeedback(actor, p, a.feedback.id, { text: 'Zusatz' }, 0, key());
  await refineFeedback(
    actor,
    p,
    a.feedback.id,
    refinement({ orderIds: [source] }),
    1,
    key(),
  );
  await refineFeedback(
    actor,
    p,
    a.feedback.id,
    refinement({ orderIds: [source] }),
    2,
    key(),
  );
  const readers = [
    (cursor?: string | null) => listFeedback(actor, p, { limit: 1, cursor }),
    (cursor?: string | null) =>
      listFeedbackEntries(actor, p, a.feedback.id, { limit: 1, cursor }),
    (cursor?: string | null) =>
      listFeedbackRefinements(actor, p, a.feedback.id, { limit: 1, cursor }),
    (cursor?: string | null) =>
      listOrderFeedbackSources(actor, p, source, { limit: 1, cursor }),
  ];
  const pages = await Promise.all(readers.map((read) => read()));
  for (const [i, read] of readers.entries()) {
    expect(pages[i].items).toHaveLength(1);
    expect(pages[i].nextCursor).toEqual(expect.any(String));
    expect((await read(pages[i].nextCursor)).nextCursor).toBeNull();
  }
  await expect(
    listFeedbackEntries(actor, p, b.feedback.id, {
      cursor: pages[1].nextCursor,
    }),
  ).rejects.toMatchObject({ code: 'validation' });
  await expect(
    listFeedbackRefinements(actor, p, a.feedback.id, {
      cursor: pages[1].nextCursor,
    }),
  ).rejects.toMatchObject({ code: 'validation' });
  await appendFeedback(
    actor,
    p,
    a.feedback.id,
    { text: 'Noch neuer' },
    3,
    key(),
  );
  for (const [i, read] of readers.entries())
    await expect(read(pages[i].nextCursor)).rejects.toMatchObject({
      code: 'conflict',
    });
});

it('verwirft eine während des Snapshots geänderte Seite', async () => {
  const p = await project(),
    f = await createFeedback(actor, p, { text: 'A' }, key());
  const batch = env.DB.batch.bind(env.DB);
  vi.spyOn(env.DB, 'batch').mockImplementationOnce(async (statements) => {
    await env.DB.prepare(
      'UPDATE feedback_threads SET revision=revision+1 WHERE id=?',
    )
      .bind(f.feedback.id)
      .run();
    return batch(statements);
  });
  await expect(
    listFeedbackEntries(actor, p, f.feedback.id),
  ).rejects.toMatchObject({ code: 'conflict' });
});

it.each([
  null,
  {},
  { text: ' ' },
  { text: 'x'.repeat(20001) },
  { text: 'x', actor: 'spoofed' },
  { text: '', attachments: null },
  { text: '', attachments: Array.from({ length: 11 }, () => manifest) },
  ...['../a.png', 'folder/a.png', 'folder\\a.png', 'a\n.png', ''].map(
    (name) => ({ text: '', attachments: [{ ...manifest, name }] }),
  ),
  ...[0, -1, 0.5, 10000001].map((size) => ({
    text: '',
    attachments: [{ ...manifest, size }],
  })),
  { text: '', attachments: [{ ...manifest, mimeType: 'application/pdf' }] },
  {
    text: '',
    attachments: [{ ...manifest, mimeType: 'video/mp4', size: 15000001 }],
  },
  { text: '', attachments: [{ ...manifest, status: 'ready' }] },
])(
  'weist ungültige Texte und Medienmanifeste ohne Teilspeicherung ab: %#',
  async (input) => {
    const p = await project(),
      before = await counts();
    await expect(
      createFeedback(actor, p, input as FeedbackInput, key()),
    ).rejects.toMatchObject({ code: 'validation' });
    expect(await counts()).toEqual(before);
  },
);

it.each([
  { repositoryCommit: 'short' },
  { documentationPolicy: '' },
  { planningPolicy: 'x'.repeat(33) },
  { summary: ' ' },
  { questions: [] },
  { questions: [''] },
  { questions: ['x'.repeat(2001)] },
  { orderIds: [''] },
  { questions: Array.from({ length: 51 }, () => 'Frage') },
  { rejectedReason: 'x'.repeat(4001) },
  { contentRevision: 5 },
  { orderIds: null },
])('validiert Refinement-Quellen und Entscheidungen: %#', async (overrides) => {
  const p = await project(),
    f = await createFeedback(actor, p, { text: 'A' }, key());
  await expect(
    refineFeedback(
      actor,
      p,
      f.feedback.id,
      refinement(overrides as Partial<RefinementInput>),
      0,
      key(),
    ),
  ).rejects.toMatchObject({ code: 'validation' });
  expect(await getFeedback(actor, p, f.feedback.id)).toEqual(f.feedback);
});

it('verlangt Identität, gültige Revision und gültigen Wiederholungsschlüssel auf allen Wegen', async () => {
  const p = await project(),
    f = await createFeedback(actor, p, { text: 'A' }, key()),
    source = await order(p);
  for (const action of [
    () => getFeedback('', p, f.feedback.id),
    () => listFeedback('', p),
    () => listFeedbackEntries('', p, f.feedback.id),
    () => listFeedbackRefinements('', p, f.feedback.id),
    () => listOrderFeedbackSources('', p, source),
    () => createFeedback('', p, { text: 'x' }, key()),
    () => appendFeedback('', p, f.feedback.id, { text: 'x' }, 0, key()),
    () => refineFeedback('', p, f.feedback.id, refinement(), 0, key()),
  ])
    await expect(action()).rejects.toMatchObject({ code: 'unauthorized' });
  await expect(
    appendFeedback(actor, p, f.feedback.id, { text: 'x' }, -1, key()),
  ).rejects.toMatchObject({ code: 'validation' });
  await expect(
    refineFeedback(actor, p, f.feedback.id, refinement(), NaN, key()),
  ).rejects.toMatchObject({ code: 'validation' });
  await expect(
    createFeedback(actor, p, { text: 'x' }, 'bad key'),
  ).rejects.toMatchObject({ code: 'validation' });
  await expect(
    appendFeedback(actor, p, f.feedback.id, { text: 'x' }, 2, key()),
  ).rejects.toMatchObject({ code: 'conflict' });
  await expect(listFeedback(actor, p, { limit: 51 })).rejects.toMatchObject({
    code: 'validation',
  });
  await expect(
    listFeedbackEntries(actor, p, f.feedback.id, { cursor: 'bad' }),
  ).rejects.toMatchObject({ code: 'validation' });
});
