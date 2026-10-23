import { env } from 'cloudflare:workers';
import { afterEach, expect, it, vi } from 'vitest';
import {
  bootstrapMilestones,
  bootstrapOrders,
  bootstrapProjectId,
} from '@/lib/domain/bootstrap';
import type { BootstrapProof } from '@/lib/domain/releases';
import {
  getBootstrapStatus,
  getOrderBootstrapProvenance,
  reconcileBootstrap,
} from '@/lib/services/bootstrap';
import { createOrder, getOrder } from '@/lib/services/orders';
import { registerProject, getProject } from '@/lib/services/projects';
const actor = 'synthetic-owner',
  key = () => crypto.randomUUID(),
  confirmation =
    'chat:festen Bootstrap1–18 nach tatsächlicher Prüfung übernehmen';
const sha = (n: number) => n.toString(16).padStart(40, '0');
const proofs = (): BootstrapProof[] =>
  Array.from({ length: 18 }, (_, i) => ({
    number: i + 1,
    kind: i === 0 ? 'sites-proof' : 'public-git',
    implementationCommit: i === 0 ? null : sha(i + 1),
    integrationCommit: i === 0 ? null : sha(100 + i),
    prUrl: i === 0 ? null : 'https://github.com/nexa16/Luufi/pull/999',
    ciUrl: i === 0 ? null : 'https://github.com/nexa16/Luufi/actions/runs/999',
    sourceCommit: sha(200 + i),
    verificationReference:
      'synthetischer Testbeleg, keine tatsächliche Implementierungsbehauptung',
    verifiedAt: '2026-10-23T10:00:00.000Z',
  }));
afterEach(async () => {
  vi.restoreAllMocks();
  await env.DB.prepare('DROP TRIGGER IF EXISTS fail_bootstrap').run();
  await env.DB.batch(
    [
      'bootstrap_provenance',
      'version_orders',
      'version_builds',
      'version_releases',
      'project_versions',
      'order_evidence',
      'order_progress',
      'order_lifecycle_events',
      'order_executions',
      'order_approval_items',
      'order_approvals',
      'planning_order_relations',
      'planning_order_versions',
      'planning_orders',
      'planning_milestones',
      'planning_requests',
      'planning_projects',
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  );
});
it('installiert ausschließlich festes Manifest mit getrennter tatsächlicher Provenienz und ohne erfundene Claims', async () => {
  expect(await getBootstrapStatus(actor)).toMatchObject({
    projectId: null,
    expectedCount: 18,
    installedCount: 0,
    complete: false,
  });
  const result = await reconcileBootstrap(
    actor,
    proofs(),
    confirmation,
    'install',
  );
  expect(result).toEqual({
    projectId: bootstrapProjectId,
    manifestVersion: '1.0.0',
    expectedCount: 18,
    installedCount: 18,
    complete: true,
  });
  expect(await getBootstrapStatus(actor)).toEqual(result);
  const p = await getProject(actor, result.projectId!);
  expect(p).toMatchObject({
    key: 'LUUFI',
    repository: 'nexa16/Luufi',
    integrationBranch: 'develop',
    productionBranch: 'main',
    nextOrderNumber: 19,
  });
  for (const wanted of bootstrapOrders) {
    expect(await getOrder(actor, p.id, wanted.id)).toMatchObject({
      number: wanted.number,
      status: 'done',
      specVersion: 1,
      type: wanted.type,
      milestoneId: wanted.milestoneId,
      position: wanted.position,
      spec: wanted.spec,
      history: [{ version: 1, spec: wanted.spec }],
    });
    expect(
      await getOrderBootstrapProvenance(actor, p.id, wanted.id),
    ).toMatchObject({
      ...proofs()[wanted.number - 1],
      orderId: wanted.id,
      displayId: `LUUFI-${wanted.number}`,
      specVersion: 1,
      manifestVersion: '1.0.0',
    });
  }
  expect(
    await env.DB.prepare(
      "SELECT count(*) AS n FROM planning_milestones WHERE state='closed'",
    ).first(),
  ).toEqual({ n: 5 });
  for (const table of [
    'order_executions',
    'order_approvals',
    'order_evidence',
    'order_lifecycle_events',
  ])
    expect(
      await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first(),
    ).toEqual({ n: 0 });
});
it('spielt Originalantwort wieder ab und verändert bei neuem identischem Schlüssel keine Domainrevisionen', async () => {
  const first = await reconcileBootstrap(actor, proofs(), confirmation, 'same'),
    before = await getProject(actor, first.projectId!);
  expect(
    await reconcileBootstrap(
      actor,
      [...proofs()].reverse(),
      confirmation,
      'same',
    ),
  ).toEqual(first);
  expect(
    await reconcileBootstrap(actor, proofs(), confirmation, 'new'),
  ).toEqual(first);
  expect(await getProject(actor, first.projectId!)).toEqual(before);
  const next = await createOrder(
    actor,
    first.projectId!,
    {
      type: 'feature',
      spec: { title: 'Echte neue Arbeit', goal: 'Ziel', origin: 'Chat' },
    },
    key(),
  );
  expect(next.displayId).toBe('LUUFI-19');
  expect(
    await getOrderBootstrapProvenance(actor, first.projectId!, next.id),
  ).toBeNull();
});
it('bewahrt bestehende Luufi-ID, Konfiguration, höheren Zähler und spätere echte Arbeit', async () => {
  const p = await registerProject(
    actor,
    {
      key: 'LUUFI',
      name: 'Mein Luufi',
      repository: 'nexa16/Luufi',
      deploymentHints: 'Private Hinweise',
    },
    key(),
  );
  await env.DB.prepare(
    'UPDATE planning_projects SET next_order_number=50 WHERE id=?',
  )
    .bind(p.id)
    .run();
  const real = await createOrder(
    actor,
    p.id,
    {
      type: 'technical',
      spec: { title: 'Spätere Arbeit', goal: 'Ziel', origin: 'Chat' },
    },
    key(),
  );
  const result = await reconcileBootstrap(actor, proofs(), confirmation, key());
  expect(result.projectId).toBe(p.id);
  expect(await getProject(actor, p.id)).toMatchObject({
    name: 'Mein Luufi',
    deploymentHints: 'Private Hinweise',
    nextOrderNumber: 51,
  });
  expect(await getOrder(actor, p.id, real.id)).toEqual(real);
});
it('repariert nur fehlende passende Bestandteile ohne bestehende Inhalte zu ersetzen', async () => {
  const result = await reconcileBootstrap(actor, proofs(), confirmation, key());
  await env.DB.prepare(
    'DELETE FROM bootstrap_provenance WHERE number=18',
  ).run();
  await env.DB.prepare('DELETE FROM planning_order_versions WHERE order_id=?')
    .bind(bootstrapOrders[17].id)
    .run();
  expect((await getBootstrapStatus(actor)).complete).toBe(false);
  expect(
    await reconcileBootstrap(actor, proofs(), confirmation, key()),
  ).toEqual(result);
});
it.each(['repository', 'milestone', 'order', 'spec', 'proof'] as const)(
  'überschreibt abweichenden %s-Bestand nicht',
  async (kind) => {
    const result = await reconcileBootstrap(
      actor,
      proofs(),
      confirmation,
      key(),
    );
    if (kind === 'repository')
      await env.DB.prepare(
        "UPDATE planning_projects SET repository='nexa16/other' WHERE id=?",
      )
        .bind(result.projectId)
        .run();
    if (kind === 'milestone')
      await env.DB.prepare(
        "UPDATE planning_milestones SET title='Andere Planung' WHERE id=?",
      )
        .bind(bootstrapMilestones[0].id)
        .run();
    if (kind === 'order')
      await env.DB.prepare(
        "UPDATE planning_orders SET status='draft' WHERE id=?",
      )
        .bind(bootstrapOrders[0].id)
        .run();
    if (kind === 'spec')
      await env.DB.prepare(
        "UPDATE planning_order_versions SET spec_json=json_set(spec_json,'$.goal','Anderes Ziel') WHERE order_id=?",
      )
        .bind(bootstrapOrders[0].id)
        .run();
    if (kind === 'proof')
      await env.DB.prepare(
        'UPDATE bootstrap_provenance SET source_commit=? WHERE number=2',
      )
        .bind(sha(999))
        .run();
    await expect(
      reconcileBootstrap(actor, proofs(), confirmation, key()),
    ).rejects.toMatchObject({
      code: 'conflict',
      message: expect.stringContaining('Bootstrap-Konflikt'),
    });
    if (kind !== 'proof')
      expect((await getBootstrapStatus(actor)).complete).toBe(false);
  },
);
it('meldet Nummernkollision statt bestehende Aufträge umzunummerieren', async () => {
  const p = await registerProject(
    actor,
    { key: 'LUUFI', name: 'Luufi', repository: 'nexa16/Luufi' },
    key(),
  );
  await env.DB.prepare(
    'UPDATE planning_projects SET next_order_number=2 WHERE id=?',
  )
    .bind(p.id)
    .run();
  const real = await createOrder(
    actor,
    p.id,
    {
      type: 'feature',
      spec: { title: 'Vorhanden', goal: 'Ziel', origin: 'Chat' },
    },
    key(),
  );
  await expect(
    reconcileBootstrap(actor, proofs(), confirmation, key()),
  ).rejects.toMatchObject({
    code: 'conflict',
    message: expect.stringContaining('LUUFI-2'),
  });
  expect(await getOrder(actor, p.id, real.id)).toEqual(real);
});
it('prüft Bestandsänderungen im atomaren Guard und rollt fehlgeschlagenen Receipt vollständig zurück', async () => {
  const p = await registerProject(
      actor,
      { key: 'LUUFI', name: 'Luufi', repository: 'nexa16/Luufi' },
      key(),
    ),
    batch = env.DB.batch.bind(env.DB);
  vi.spyOn(env.DB, 'batch').mockImplementationOnce(async (statements) => {
    await env.DB.prepare(
      'UPDATE planning_projects SET planning_revision=planning_revision+1 WHERE id=?',
    )
      .bind(p.id)
      .run();
    return batch(statements);
  });
  await expect(
    reconcileBootstrap(actor, proofs(), confirmation, key()),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect((await getBootstrapStatus(actor)).installedCount).toBe(0);
  await env.DB.prepare(
    "CREATE TRIGGER fail_bootstrap BEFORE UPDATE ON planning_requests BEGIN SELECT RAISE(ABORT,'PRIVATE'); END",
  ).run();
  await expect(
    reconcileBootstrap(actor, proofs(), confirmation, key()),
  ).rejects.toMatchObject({ code: 'unavailable' });
  expect((await getBootstrapStatus(actor)).installedCount).toBe(0);
  expect(
    await env.DB.prepare('SELECT count(*) AS n FROM planning_orders').first(),
  ).toEqual({ n: 0 });
  expect(
    await env.DB.prepare(
      'SELECT count(*) AS n FROM planning_milestones',
    ).first(),
  ).toEqual({ n: 0 });
});
it('verhindert doppelte Installation bei parallelem identischem Request', async () => {
  const results = await Promise.all([
    reconcileBootstrap(actor, proofs(), confirmation, 'parallel'),
    reconcileBootstrap(actor, proofs(), confirmation, 'parallel'),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect((await getBootstrapStatus(actor)).installedCount).toBe(18);
});
it('validiert feste Proofmenge, private Proofgrenze, URLs und Bestätigung', async () => {
  const invalids = [
    proofs().slice(0, 17),
    proofs().map((p, i) => (i === 17 ? { ...p, number: 17 } : p)),
    proofs().map((p, i) =>
      i === 0 ? { ...p, implementationCommit: sha(1) } : p,
    ),
    proofs().map((p, i) =>
      i === 1 ? { ...p, prUrl: 'https://github.com/nexa16/Other/pull/1' } : p,
    ),
    proofs().map((p, i) => (i === 1 ? { ...p, sourceCommit: 'short' } : p)),
    proofs().map((p, i) => (i === 1 ? { ...p, verificationReference: '' } : p)),
    proofs().map((p, i) => (i === 1 ? { ...p, verifiedAt: 'yesterday' } : p)),
    proofs().map((p, i) => (i === 1 ? { ...p, sql: 'arbitrary' } : p)),
  ];
  for (const input of invalids)
    await expect(
      reconcileBootstrap(actor, input as BootstrapProof[], confirmation, key()),
    ).rejects.toMatchObject({ code: 'validation' });
  await expect(
    reconcileBootstrap(actor, proofs(), ' ', key()),
  ).rejects.toMatchObject({ code: 'validation' });
  expect((await getBootstrapStatus(actor)).projectId).toBeNull();
});
it('verlangt Identität und Getter prüft Projekt, Nummer sowie done-Status', async () => {
  await expect(getBootstrapStatus('')).rejects.toMatchObject({
    code: 'unauthorized',
  });
  await expect(
    reconcileBootstrap('', proofs(), confirmation, key()),
  ).rejects.toMatchObject({ code: 'unauthorized' });
  const result = await reconcileBootstrap(actor, proofs(), confirmation, key());
  await expect(
    reconcileBootstrap('other', proofs(), confirmation, key()),
  ).resolves.toMatchObject({ complete: true });
  await expect(
    getOrderBootstrapProvenance(actor, 'other', bootstrapOrders[0].id),
  ).rejects.toMatchObject({ code: 'not_found' });
  await env.DB.prepare("UPDATE planning_orders SET status='draft' WHERE id=?")
    .bind(bootstrapOrders[0].id)
    .run();
  await expect(
    getOrderBootstrapProvenance(
      actor,
      result.projectId!,
      bootstrapOrders[0].id,
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
});
