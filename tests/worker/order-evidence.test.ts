import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EvidenceInput, GitObservation } from '@/lib/domain/execution';
import {
  recordValidation,
  recordImplementation,
  recordIntegration,
  listOrderEvidence,
} from '@/lib/services/order-evidence';
import { getOrder } from '@/lib/services/orders';
const commit = 'a'.repeat(40),
  head = 'b'.repeat(40),
  merge = 'c'.repeat(40),
  now = '2026-10-23T10:00:00.000Z';
const obs = (overrides: Partial<GitObservation> = {}): GitObservation => ({
  repository: 'owner/repo',
  branch: 'codex/test',
  remoteRef: 'origin/codex/test',
  headSha: head,
  commitSha: commit,
  observedAt: now,
  source: 'codex-local-git',
  commitSubject: 'feat(APP-1): Implementiert',
  parentShas: ['d'.repeat(40)],
  ancestorOfHead: true,
  pushed: true,
  pr: null,
  ci: [],
  ...overrides,
});
const input = (overrides: Partial<EvidenceInput> = {}): EvidenceInput => ({
  outcome: 'success',
  executionId: 'exec',
  generation: 1,
  commitSha: commit,
  summary: 'Automatisch geprüft',
  criteria: [{ id: 'AC1', result: 'pass', reference: 'test: focused suite' }],
  documentationReference: 'docs/features/example.md geprüft',
  observation: null,
  ...overrides,
});
async function seed() {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO planning_projects(id,project_key,name,repository,integration_branch,production_branch,documentation_paths,deployment_hints) VALUES('p','APP','Test','owner/repo','develop','main','[]','')",
    ),
    env.DB.prepare(
      "INSERT INTO planning_milestones(id,project_id,title,description,position) VALUES('m','p','Milestone','',0)",
    ),
    env.DB.prepare(
      "INSERT INTO planning_orders(id,project_id,number,type,status,milestone_id,position) VALUES('o','p',1,'feature','implementing','m',0)",
    ),
    env.DB.prepare(
      "INSERT INTO planning_order_versions(order_id,version,spec_json,created_at) VALUES('o',1,?,?)",
    ).bind(
      JSON.stringify({
        title: 'Test',
        criteria: [{ id: 'AC1', text: 'Verhalten' }],
      }),
      now,
    ),
    env.DB.prepare(
      "INSERT INTO order_approvals(id,project_id,mode,confirmation_reference,created_at) VALUES('approval','p','selection','Nutzerchat',?)",
    ).bind(now),
    env.DB.prepare(
      "INSERT INTO order_approval_items(approval_id,order_id,spec_version,title,dependency_ids_json,repository,integration_branch) VALUES('approval','o',1,'Test','[]','owner/repo','develop')",
    ),
    env.DB.prepare(
      "INSERT INTO order_executions(id,project_id,order_id,spec_version,approval_id,worker,branch,generation,phase,created_at,updated_at) VALUES('exec','p','o',1,'approval','codex','codex/test',1,'active',?,?)",
    ).bind(now, now),
  ]);
}
afterEach(async () => {
  await env.DB.prepare('DROP TRIGGER IF EXISTS fail_evidence').run();
  for (const table of [
    'order_evidence',
    'order_lifecycle_events',
    'order_progress',
    'order_executions',
    'order_approval_items',
    'order_approvals',
    'planning_order_versions',
    'planning_orders',
    'planning_milestones',
    'planning_projects',
    'planning_requests',
  ])
    await env.DB.prepare(`DELETE FROM ${table}`).run();
});
const revision = async () =>
  (await env.DB.prepare(
    "SELECT revision FROM planning_orders WHERE id='o'",
  ).first<{ revision: number }>())!.revision;
const saveValidation = () =>
  recordValidation('owner', 'p', 'o', input(), 0, 'validation');
async function saveImplementation() {
  const v = await saveValidation();
  const i = await recordImplementation(
    'owner',
    'p',
    'o',
    input({ validationId: v.id, observation: obs() }),
    1,
    'implementation',
  );
  return { v, i };
}
function integration(): EvidenceInput {
  return input({
    unavailableBuildReason: 'Bereitstellung folgt in W6.',
    observation: obs({
      branch: 'develop',
      remoteRef: 'origin/develop',
      headSha: merge,
      pr: {
        url: 'https://github.com/owner/repo/pull/1',
        baseBranch: 'develop',
        headSha: head,
        merged: true,
        mergeSha: merge,
        normalMerge: true,
      },
      ci: [
        {
          url: 'https://github.com/owner/repo/actions/runs/1',
          name: 'verify',
          headSha: head,
          conclusion: 'success',
        },
      ],
    }),
  });
}
describe('LUUFI-14 owner-authenticated Codex evidence', () => {
  it('accepts the exact configured HTTPS repository identity returned by the local helper', async () => {
    await seed();
    const repository = 'https://github.com/owner/repo';
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE planning_projects SET repository=? WHERE id='p'",
      ).bind(repository),
      env.DB.prepare(
        "UPDATE order_approval_items SET repository=? WHERE order_id='o'",
      ).bind(repository),
    ]);
    const validation = await saveValidation();
    const saved = await recordImplementation(
      'owner',
      'p',
      'o',
      input({ validationId: validation.id, observation: obs({ repository }) }),
      1,
      'https-implementation',
    );
    expect(saved.observation?.repository).toBe(repository);
    expect((await getOrder('owner', 'p', 'o')).status).toBe('implemented');
  });
  it('records exact criteria then implementation and integration atomically, preserving immutable history', async () => {
    await seed();
    const { v, i } = await saveImplementation();
    expect(i).toMatchObject({
      kind: 'implementation',
      validationId: v.id,
      supersedesId: null,
      specVersion: 1,
    });
    expect((await getOrder('owner', 'p', 'o')).status).toBe('implemented');
    const done = await recordIntegration(
      'owner',
      'p',
      'o',
      integration(),
      2,
      'integration',
    );
    expect(done.kind).toBe('integration');
    expect((await getOrder('owner', 'p', 'o')).status).toBe('done');
    expect(
      await env.DB.prepare(
        "SELECT phase FROM order_executions WHERE id='exec'",
      ).first(),
    ).toEqual({ phase: 'closed' });
    expect(
      await env.DB.prepare(
        "SELECT state FROM planning_milestones WHERE id='m'",
      ).first(),
    ).toEqual({ state: 'closed' });
    expect(
      (await listOrderEvidence('owner', 'p', 'o')).items.map((e) => e.kind),
    ).toEqual(['validation', 'implementation', 'integration']);
    expect(
      await recordValidation('owner', 'p', 'o', input(), 0, 'validation'),
    ).toEqual(v);
    await expect(
      recordValidation('owner', 'p', 'o', input(), 3, 'new-after-done'),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
  it('binds replay to actor/payload and rejects unknown fields, missing/duplicate criteria and false successes', async () => {
    await seed();
    const saved = await saveValidation();
    expect(saved.validationId).toBeNull();
    await expect(
      recordValidation('other', 'p', 'o', input(), 0, 'validation'),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      recordValidation(
        'owner',
        'p',
        'o',
        input({ summary: 'Anders' }),
        0,
        'validation',
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      recordValidation('', 'p', 'o', input(), 1, 'auth'),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(
      recordValidation('owner', 'elsewhere', 'o', input(), 1, 'scope'),
    ).rejects.toMatchObject({ code: 'not_found' });
    for (const value of [
      input({ criteria: [] }),
      input({ criteria: [...input().criteria, ...input().criteria] }),
      input({
        criteria: [{ id: 'AC1', result: 'fail', reference: 'Fehlgeschlagen' }],
      }),
      { ...input(), serverVerified: true },
    ])
      await expect(
        recordValidation('owner', 'p', 'o', value, 1, crypto.randomUUID()),
      ).rejects.toMatchObject({ code: 'validation' });
  });
  it('permits justified manual-only verification without user acceptance and preserves paused failures without advancing status', async () => {
    await seed();
    const manual = input({
      criteria: [
        {
          id: 'AC1',
          result: 'manual-only',
          reference:
            'Codecwiedergabe braucht Browserprüfung; Formatpipeline automatisiert geprüft.',
        },
      ],
    });
    await recordValidation('owner', 'p', 'o', manual, 0, 'manual');
    await env.DB.prepare("UPDATE order_executions SET phase='paused'").run();
    await recordImplementation(
      'owner',
      'p',
      'o',
      input({
        outcome: 'failure',
        summary: 'Prüfung gescheitert',
        documentationReference: '',
        criteria: [{ id: 'AC1', result: 'fail', reference: 'test failure' }],
      }),
      1,
      'failure',
    );
    expect((await getOrder('owner', 'p', 'o')).status).toBe('implementing');
    await expect(
      recordValidation('owner', 'p', 'o', input(), 2, 'paused-success'),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
  it('requires matching validation, pushed commit, active generation and correct commit identity', async () => {
    await seed();
    const v = await saveValidation();
    for (const changed of [
      { validationId: 'missing' },
      { observation: obs({ pushed: false }) },
      { observation: obs({ ancestorOfHead: false }) },
      { observation: obs({ repository: 'other/repo' }) },
      { observation: obs({ branch: 'elsewhere' }) },
      { observation: obs({ commitSubject: 'feat(APP-10): anderer Auftrag' }) },
      { observation: obs({ parentShas: [head, merge] }) },
      { commitSha: head, observation: obs({ commitSha: head }) },
    ])
      await expect(
        recordImplementation(
          'owner',
          'p',
          'o',
          input({ validationId: v.id, observation: obs(), ...changed }),
          1,
          crypto.randomUUID(),
        ),
      ).rejects.toMatchObject({ code: 'validation' });
    await env.DB.prepare('UPDATE order_executions SET generation=2').run();
    await expect(
      recordImplementation(
        'owner',
        'p',
        'o',
        input({ validationId: v.id, observation: obs() }),
        1,
        'old-generation',
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
  it('replaces only the explicit current candidate with a newly validated commit', async () => {
    await seed();
    const { i } = await saveImplementation();
    const nextInput = input({ commitSha: head });
    const v2 = await recordValidation(
      'owner',
      'p',
      'o',
      nextInput,
      2,
      'validation2',
    );
    await expect(
      recordImplementation(
        'owner',
        'p',
        'o',
        input({
          commitSha: head,
          validationId: v2.id,
          observation: obs({ commitSha: head }),
        }),
        3,
        'missing-supersedes',
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    const newer = await recordImplementation(
      'owner',
      'p',
      'o',
      input({
        commitSha: head,
        validationId: v2.id,
        observation: obs({ commitSha: head }),
        supersedesId: i.id,
      }),
      3,
      'replacement',
    );
    expect(newer.supersedesId).toBe(i.id);
    expect(
      (await listOrderEvidence('owner', 'p', 'o')).items.filter(
        (e) => e.kind === 'implementation',
      ),
    ).toHaveLength(2);
    await expect(
      recordIntegration('owner', 'p', 'o', integration(), 4, 'old-integration'),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
  it('refuses squash/rebase, wrong CI head, failed/pending CI and missing build reason', async () => {
    await seed();
    await saveImplementation();
    const original = integration();
    for (const next of [
      input({ observation: original.observation! }),
      {
        ...original,
        observation: {
          ...original.observation!,
          pr: { ...original.observation!.pr!, normalMerge: false },
        },
      },
      {
        ...original,
        observation: {
          ...original.observation!,
          ci: [{ ...original.observation!.ci[0], headSha: commit }],
        },
      },
      {
        ...original,
        observation: {
          ...original.observation!,
          ci: [
            ...original.observation!.ci,
            {
              ...original.observation!.ci[0],
              name: 'other',
              conclusion: 'failure' as const,
            },
          ],
        },
      },
      {
        ...original,
        observation: {
          ...original.observation!,
          ci: [
            { ...original.observation!.ci[0], conclusion: 'pending' as const },
          ],
        },
      },
    ])
      await expect(
        recordIntegration('owner', 'p', 'o', next, 2, crypto.randomUUID()),
      ).rejects.toMatchObject({ code: 'validation' });
    expect((await getOrder('owner', 'p', 'o')).status).toBe('implemented');
  });
  it('rolls back evidence/status/receipt/events on storage failure and gives one result to concurrent same-key writes', async () => {
    await seed();
    await env.DB.prepare(
      "CREATE TRIGGER fail_evidence BEFORE UPDATE ON planning_requests BEGIN SELECT RAISE(ABORT,'synthetic'); END",
    ).run();
    await expect(saveValidation()).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect((await listOrderEvidence('owner', 'p', 'o')).items).toHaveLength(0);
    expect(await revision()).toBe(0);
    await env.DB.prepare('DROP TRIGGER fail_evidence').run();
    const results = await Promise.all([saveValidation(), saveValidation()]);
    expect(results[0]).toEqual(results[1]);
    expect(await revision()).toBe(1);
  });
  it('binds paginated history cursors to lifecycle revision and refuses stale concurrent writers', async () => {
    await seed();
    await saveValidation();
    const page = await listOrderEvidence('owner', 'p', 'o', { limit: 1 });
    expect(page.nextCursor).toBeNull();
    await recordValidation(
      'owner',
      'p',
      'o',
      input({ outcome: 'failure' }),
      1,
      'failure',
    );
    const paged = await listOrderEvidence('owner', 'p', 'o', { limit: 1 });
    expect(paged.nextCursor).not.toBeNull();
    await recordValidation(
      'owner',
      'p',
      'o',
      input({ outcome: 'unavailable' }),
      2,
      'unavailable',
    );
    await expect(
      listOrderEvidence('owner', 'p', 'o', {
        limit: 1,
        cursor: paged.nextCursor,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    const attempts = await Promise.allSettled(
      ['one', 'two'].map((key) =>
        recordValidation('owner', 'p', 'o', input(), 3, key),
      ),
    );
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('fails closed if approval context changes after preflight before the atomic mutation', async () => {
    await seed();
    const prepare = env.DB.prepare.bind(env.DB);
    let intercepted = false;
    vi.spyOn(env.DB, 'prepare').mockImplementation((query) => {
      const statement = prepare(query);
      if (!query.startsWith('SELECT o.*') || intercepted) return statement;
      return {
        bind: (...params: unknown[]) => {
          const bound = statement.bind(...params);
          return {
            first: async () => {
              const row = await bound.first();
              intercepted = true;
              await prepare(
                "UPDATE planning_projects SET repository='owner/changed' WHERE id='p'",
              ).run();
              return row;
            },
          } as D1PreparedStatement;
        },
      } as D1PreparedStatement;
    });
    await expect(saveValidation()).rejects.toMatchObject({ code: 'conflict' });
    expect(await revision()).toBe(0);
  });
});
