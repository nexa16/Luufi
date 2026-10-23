import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  BuildInput,
  ReleaseInput,
  VersionInput,
} from '@/lib/domain/releases';
import {
  createProjectVersion,
  getLatestAvailableVersion,
  getProjectVersion,
  listProjectVersions,
  listVersionBuilds,
  listVersionOrders,
  listVersionReleases,
  recordVersionBuild,
  recordVersionRelease,
} from '@/lib/services/project-versions';
const a = 'a'.repeat(40),
  b = 'b'.repeat(40),
  c = 'c'.repeat(40),
  d = 'd'.repeat(40),
  now = '2026-10-23T10:00:00.000Z';
async function seed(count = 1) {
  await env.DB.prepare(
    "INSERT INTO planning_projects(id,project_key,name,repository,integration_branch,production_branch,documentation_paths,deployment_hints) VALUES('p','APP','Projekt','owner/repo','develop','main','[]','')",
  ).run();
  await env.DB.prepare(
    "INSERT INTO planning_milestones(id,project_id,title,description,position,state) VALUES('m','p','Milestone','',0,'closed')",
  ).run();
  for (let number = 1; number <= count; number++)
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO planning_orders(id,project_id,number,type,status,milestone_id,position) VALUES(?,'p',?,'feature','done','m',?)",
      ).bind(`o${number}`, number, number),
      env.DB.prepare(
        'INSERT INTO planning_order_versions(order_id,version,spec_json,created_at) VALUES(?,1,?,?)',
      ).bind(
        `o${number}`,
        JSON.stringify({
          title: `Auftrag ${number}`,
          criteria: [{ id: 'AC1', text: 'Ziel' }],
        }),
        now,
      ),
      env.DB.prepare(
        "INSERT INTO bootstrap_provenance(order_id,number,kind,implementation_commit,integration_commit,pr_url,ci_url,source_commit,verification_reference,verified_at,manifest_version,created_at) VALUES(?,?,'public-git',?,?,'https://github.com/owner/repo/pull/1','https://github.com/owner/repo/actions/runs/1',?,'Codex geprüft',?,'1.0.0',?)",
      ).bind(`o${number}`, number, a, b, b, now, now),
    ]);
}
const versionInput = (overrides: Partial<VersionInput> = {}): VersionInput => ({
  label: 'Vorschau 1',
  channel: 'develop',
  title: 'Eine Version',
  changelog: 'Neue Funktionen und Korrekturen.',
  repositoryCommit: b,
  sourceBranch: 'develop',
  scope: { mode: 'selection', orderIds: ['o1'] },
  ...overrides,
});
const create = (
  label = 'Vorschau 1',
  channel: 'develop' | 'production' = 'develop',
) =>
  createProjectVersion(
    'owner',
    'p',
    versionInput({ label, channel }),
    0,
    `create-${label}`.replaceAll(' ', '.'),
  );
const build = (overrides: Partial<BuildInput> = {}): BuildInput => ({
  kind: 'site',
  outcome: 'available',
  url: 'https://preview.example.invalid',
  reason: '',
  environment: 'preview',
  projectCommit: b,
  sourceKind: 'sites',
  sourceBranch: 'main',
  sourceCommit: d,
  versionCommitIncluded: true,
  mappingReference: 'Public b40 entspricht Hosting d40; Health/Banner geprüft.',
  observedAt: now,
  verificationReference: 'Geschützte Vorschau tatsächlich geprüft.',
  ...overrides,
});
const release = (
  buildId: string,
  overrides: Partial<ReleaseInput> = {},
): ReleaseInput => ({
  confirmationReference: 'Nutzerchat: Version ausdrücklich veröffentlichen.',
  productionBranch: 'main',
  productionCommit: b,
  tag: '2026.10',
  tagCommit: b,
  buildId,
  deploymentReference: 'Privates Hostingziel mit Health und Banner geprüft.',
  observation: {
    repository: 'owner/repo',
    productionBranch: 'main',
    productionHead: b,
    tag: '2026.10',
    tagCommit: b,
    versionCommit: b,
    versionCommitIncluded: true,
    observedAt: now,
    source: 'codex-local-git',
    ci: [
      {
        url: 'https://github.com/owner/repo/actions/runs/9',
        name: 'CI',
        headSha: b,
        conclusion: 'success',
      },
    ],
  },
  ...overrides,
});
afterEach(async () => {
  await env.DB.prepare('DROP TRIGGER IF EXISTS fail_versions').run();
  for (const table of [
    'version_releases',
    'version_builds',
    'version_orders',
    'project_versions',
    'bootstrap_provenance',
    'order_evidence',
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
describe('LUUFI-16 immutable project versions and observed availability', () => {
  it.each(['repository', 'production_branch'] as const)(
    'replays a concurrent identical release after mutable %s configuration changes',
    async (field) => {
      await seed();
      const v = await create('ConfigRace', 'production');
      const built = await recordVersionBuild(
        'owner',
        'p',
        v.id,
        build({ environment: 'production' }),
        0,
        'config-build',
      );
      const value = release(built.id),
        prepare = env.DB.prepare.bind(env.DB);
      let intercepted = false,
        winning: unknown;
      vi.spyOn(env.DB, 'prepare').mockImplementation((query) => {
        const statement = prepare(query);
        if (
          intercepted ||
          query !== 'SELECT * FROM planning_projects WHERE id=?'
        )
          return statement;
        return {
          bind: (...params: unknown[]) => {
            const bound = statement.bind(...params);
            return {
              first: async () => {
                intercepted = true;
                winning = await recordVersionRelease(
                  'owner',
                  'p',
                  v.id,
                  value,
                  1,
                  'config-raced-release',
                );
                await prepare(
                  field === 'repository'
                    ? "UPDATE planning_projects SET repository='owner/newrepo',revision=revision+1 WHERE id='p'"
                    : "UPDATE planning_projects SET production_branch='master',revision=revision+1 WHERE id='p'",
                ).run();
                return bound.first();
              },
            } as D1PreparedStatement;
          },
        } as D1PreparedStatement;
      });
      expect(
        await recordVersionRelease(
          'owner',
          'p',
          v.id,
          value,
          1,
          'config-raced-release',
        ),
      ).toEqual(winning);
    },
  );
  it('replays a concurrently recorded identical release even after a newer build failure invalidates availability', async () => {
    await seed();
    const v = await create('Race', 'production');
    const built = await recordVersionBuild(
      'owner',
      'p',
      v.id,
      build({ environment: 'production' }),
      0,
      'race-build',
    );
    const value = release(built.id),
      prepare = env.DB.prepare.bind(env.DB);
    let intercepted = false,
      winning: unknown;
    vi.spyOn(env.DB, 'prepare').mockImplementation((query) => {
      const statement = prepare(query);
      if (intercepted || !query.includes('WHERE b.id=? AND b.version_id=?'))
        return statement;
      return {
        bind: (...params: unknown[]) => {
          const bound = statement.bind(...params);
          return {
            first: async () => {
              intercepted = true;
              winning = await recordVersionRelease(
                'owner',
                'p',
                v.id,
                value,
                1,
                'raced-release',
              );
              await recordVersionBuild(
                'owner',
                'p',
                v.id,
                build({
                  environment: 'production',
                  outcome: 'failure',
                  url: null,
                  reason: 'Nach Release fehlgeschlagen.',
                  observedAt: '2026-10-23T12:00:00Z',
                }),
                2,
                'later-failure',
              );
              return bound.first();
            },
          } as D1PreparedStatement;
        },
      } as D1PreparedStatement;
    });
    const result = await recordVersionRelease(
      'owner',
      'p',
      v.id,
      value,
      1,
      'raced-release',
    );
    expect(result).toEqual(winning);
    expect((await listVersionReleases('owner', 'p', v.id)).items).toHaveLength(
      1,
    );
  });
  it('snapshots the current successful W5 implementation and integration instead of inventing bootstrap provenance', async () => {
    await seed();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO order_approvals(id,project_id,mode,confirmation_reference,created_at) VALUES('approval','p','selection','Synthetic owner approval',?)",
      ).bind(now),
      env.DB.prepare(
        "INSERT INTO order_executions(id,project_id,order_id,spec_version,approval_id,worker,branch,generation,phase,created_at,updated_at) VALUES('exec','p','o1',1,'approval','codex','codex/test',1,'closed',?,?)",
      ).bind(now, now),
      env.DB.prepare(
        "INSERT INTO order_evidence(id,order_id,spec_version,kind,outcome,execution_id,generation,payload_json,created_at) VALUES('implementation','o1',1,'implementation','success','exec',1,?,?)",
      ).bind(JSON.stringify({ commitSha: a }), now),
      env.DB.prepare(
        "INSERT INTO order_evidence(id,order_id,spec_version,kind,outcome,execution_id,generation,payload_json,created_at) VALUES('integration','o1',1,'integration','success','exec',1,?,?)",
      ).bind(
        JSON.stringify({
          commitSha: a,
          observation: { pr: { url: 'https://github.com/owner/repo/pull/2' } },
        }),
        now,
      ),
      env.DB.prepare(
        "UPDATE planning_orders SET current_implementation_id='implementation',integration_id='integration' WHERE id='o1'",
      ),
      env.DB.prepare('DELETE FROM bootstrap_provenance'),
    ]);
    const v = await create();
    expect(
      (await listVersionOrders('owner', 'p', v.id)).items[0],
    ).toMatchObject({
      provenanceKind: 'execution',
      implementationId: 'implementation',
      integrationId: 'integration',
      implementationCommit: a,
    });
    await env.DB.prepare(
      "UPDATE order_evidence SET spec_version=2 WHERE id='integration'",
    ).run();
    await expect(create('Invalid proof')).rejects.toMatchObject({
      code: 'conflict',
    });
  });
  it('freezes version content and bootstrap order provenance without later membership or text changes', async () => {
    await seed();
    const v = await create();
    expect(v).toMatchObject({ revision: 0, releaseId: null, orderCount: 1 });
    const members = await listVersionOrders('owner', 'p', v.id);
    expect(members.items[0]).toMatchObject({
      title: 'Auftrag 1',
      provenanceKind: 'bootstrap',
      implementationId: null,
      integrationId: null,
      implementationCommit: a,
    });
    await env.DB.prepare(
      "UPDATE planning_order_versions SET spec_json=json_set(spec_json,'$.title','Später geändert') WHERE order_id='o1'",
    ).run();
    expect((await listVersionOrders('owner', 'p', v.id)).items[0].title).toBe(
      'Auftrag 1',
    );
    expect(await getProjectVersion('owner', 'p', v.id)).toEqual(v);
    expect(await create()).toEqual(v);
    await expect(
      createProjectVersion(
        'owner',
        'p',
        versionInput({ title: 'Anderer Inhalt' }),
        0,
        'create-Vorschau.1',
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
  it('captures every milestone member beyond fifty while keeping explicit selection bounded', async () => {
    await seed(55);
    const v = await createProjectVersion(
      'owner',
      'p',
      versionInput({ scope: { mode: 'milestone', milestoneId: 'm' } }),
      0,
      'milestone',
    );
    expect(v.orderCount).toBe(55);
    const first = await listVersionOrders('owner', 'p', v.id, { limit: 50 });
    expect(first.items).toHaveLength(50);
    expect(first.items.slice(0, 3).map((item) => item.displayId)).toEqual([
      'APP-1',
      'APP-2',
      'APP-3',
    ]);
    expect(
      (
        await listVersionOrders('owner', 'p', v.id, {
          limit: 50,
          cursor: first.nextCursor,
        })
      ).items,
    ).toHaveLength(5);
    await expect(
      createProjectVersion(
        'owner',
        'p',
        versionInput({
          scope: {
            mode: 'selection',
            orderIds: Array.from({ length: 51 }, (_, i) => `o${i + 1}`),
          },
        }),
        0,
        'too-large',
      ),
    ).rejects.toMatchObject({ code: 'validation' });
  });
  it('rejects incomplete, foreign, unproven and Sites-only bootstrap scope', async () => {
    await seed();
    await expect(
      createProjectVersion(
        'owner',
        'p',
        versionInput({ scope: { mode: 'selection', orderIds: ['missing'] } }),
        0,
        'missing',
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    await env.DB.prepare(
      "UPDATE planning_orders SET status='implemented' WHERE id='o1'",
    ).run();
    await expect(create()).rejects.toMatchObject({ code: 'conflict' });
    await env.DB.prepare(
      "UPDATE planning_orders SET status='done' WHERE id='o1'",
    ).run();
    await env.DB.prepare(
      "UPDATE bootstrap_provenance SET kind='sites-proof',implementation_commit=NULL,integration_commit=NULL,pr_url=NULL,ci_url=NULL",
    ).run();
    await expect(create()).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      createProjectVersion('', 'p', versionInput(), 0, 'auth'),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(
      createProjectVersion('owner', 'elsewhere', versionInput(), 0, 'foreign'),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
  it('separates public and hosting SHAs and requires explicit verified mappings', async () => {
    await seed();
    const v = await create();
    const saved = await recordVersionBuild(
      'owner',
      'p',
      v.id,
      build(),
      0,
      'build',
    );
    expect(saved).toMatchObject({
      projectCommit: b,
      sourceCommit: d,
      sourceKind: 'sites',
    });
    expect(
      await recordVersionBuild('owner', 'p', v.id, build(), 0, 'build'),
    ).toEqual(saved);
    for (const next of [
      build({ sourceKind: 'github' }),
      build({ mappingReference: '' }),
      build({ projectCommit: c, versionCommitIncluded: false }),
      build({ url: 'javascript:alert(1)' }),
      build({
        outcome: 'failure',
        url: 'https://wrong.invalid',
        reason: 'Fehler',
      }),
    ])
      await expect(
        recordVersionBuild('owner', 'p', v.id, next, 1, crypto.randomUUID()),
      ).rejects.toMatchObject({ code: 'validation' });
    const github = build({
      sourceKind: 'github',
      sourceCommit: b,
      mappingReference: '',
    });
    expect(
      (await recordVersionBuild('owner', 'p', v.id, github, 1, 'github-build'))
        .sourceCommit,
    ).toBe(b);
  });
  it('selects the latest available version and invalidates only the newest observation for each build target', async () => {
    await seed();
    const older = await create('Alt');
    const oldBuild = await recordVersionBuild(
      'owner',
      'p',
      older.id,
      build(),
      0,
      'older-build',
    );
    const newer = await create('Neu');
    await recordVersionBuild(
      'owner',
      'p',
      newer.id,
      build({ outcome: 'unavailable', url: null, reason: 'Noch kein Build.' }),
      0,
      'new-unavailable',
    );
    expect((await getLatestAvailableVersion('owner', 'p'))?.version.id).toBe(
      older.id,
    );
    await recordVersionBuild(
      'owner',
      'p',
      newer.id,
      build({ observedAt: '2026-10-23T11:00:00Z' }),
      1,
      'new-available',
    );
    expect((await getLatestAvailableVersion('owner', 'p'))?.version.id).toBe(
      newer.id,
    );
    await recordVersionBuild(
      'owner',
      'p',
      newer.id,
      build({
        outcome: 'failure',
        url: null,
        reason: 'Vorschau ausgefallen.',
        observedAt: '2026-10-23T12:00:00Z',
      }),
      2,
      'new-failure',
    );
    expect((await getLatestAvailableVersion('owner', 'p'))?.build.id).toBe(
      oldBuild.id,
    );
    await recordVersionBuild(
      'owner',
      'p',
      newer.id,
      build({
        kind: 'apk',
        url: 'https://download.example.invalid/app.apk',
        observedAt: '2026-10-23T13:00:00Z',
      }),
      3,
      'apk',
    );
    expect((await getLatestAvailableVersion('owner', 'p'))?.version.id).toBe(
      newer.id,
    );
    await recordVersionBuild(
      'owner',
      'p',
      newer.id,
      build({
        kind: 'apk',
        outcome: 'failure',
        url: null,
        reason: 'Historischer Fehlversuch',
        observedAt: '2026-10-23T09:00:00Z',
      }),
      4,
      'old-failure',
    );
    expect((await getLatestAvailableVersion('owner', 'p'))?.build.kind).toBe(
      'apk',
    );
  });
  it('uses the later stored receipt when observation timestamps tie and retains immutable history', async () => {
    await seed();
    const v = await create();
    await recordVersionBuild('owner', 'p', v.id, build(), 0, 'available');
    await recordVersionBuild(
      'owner',
      'p',
      v.id,
      build({
        outcome: 'failure',
        url: null,
        reason: 'Gleicher Zeitpunkt, neuer Befund.',
      }),
      1,
      'failed',
    );
    expect(await getLatestAvailableVersion('owner', 'p')).toBeNull();
    expect(
      (await listVersionBuilds('owner', 'p', v.id)).items.map((x) => x.outcome),
    ).toEqual(['failure', 'available']);
  });
  it('keeps production candidates distinct and records an explicitly approved release atomically', async () => {
    await seed();
    const v = await create('Produktion', 'production');
    expect(v.releaseId).toBeNull();
    const built = await recordVersionBuild(
      'owner',
      'p',
      v.id,
      build({
        environment: 'production',
        url: 'https://production.example.invalid',
      }),
      0,
      'production-build',
    );
    const released = await recordVersionRelease(
      'owner',
      'p',
      v.id,
      release(built.id),
      1,
      'release',
    );
    expect((await getProjectVersion('owner', 'p', v.id)).releaseId).toBe(
      released.id,
    );
    expect((await listVersionReleases('owner', 'p', v.id)).items).toEqual([
      released,
    ]);
    expect(
      await recordVersionRelease(
        'owner',
        'p',
        v.id,
        release(built.id),
        1,
        'release',
      ),
    ).toEqual(released);
    await expect(
      recordVersionRelease(
        'owner',
        'p',
        v.id,
        release(built.id),
        2,
        'second-release',
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
  it('rejects false production branches/tags, stale availability, wrong CI heads and missing confirmation', async () => {
    await seed();
    const v = await create('Kandidat', 'production');
    const built = await recordVersionBuild(
      'owner',
      'p',
      v.id,
      build({ environment: 'production' }),
      0,
      'production-build',
    );
    const original = release(built.id);
    for (const next of [
      release(built.id, { confirmationReference: '' }),
      release(built.id, { productionBranch: 'develop' }),
      release(built.id, { tagCommit: c }),
      release(built.id, {
        observation: { ...original.observation, productionHead: c },
      }),
      release(built.id, {
        observation: {
          ...original.observation,
          ci: [{ ...original.observation.ci[0], headSha: c }],
        },
      }),
      release(built.id, {
        observation: {
          ...original.observation,
          ci: [
            ...original.observation.ci,
            { ...original.observation.ci[0], conclusion: 'failure' },
          ],
        },
      }),
    ])
      await expect(
        recordVersionRelease('owner', 'p', v.id, next, 1, crypto.randomUUID()),
      ).rejects.toMatchObject({ code: 'validation' });
    await recordVersionBuild(
      'owner',
      'p',
      v.id,
      build({
        environment: 'production',
        outcome: 'unavailable',
        url: null,
        reason: 'Nicht mehr erreichbar.',
        observedAt: '2026-10-23T12:00:00Z',
      }),
      1,
      'expired-build',
    );
    await expect(
      recordVersionRelease('owner', 'p', v.id, original, 2, 'stale-build'),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
  it('rolls back an incomplete create and rejects stale writers and cursor snapshots', async () => {
    await seed();
    await env.DB.prepare(
      "CREATE TRIGGER fail_versions BEFORE UPDATE ON planning_requests BEGIN SELECT RAISE(ABORT,'synthetic'); END",
    ).run();
    await expect(create()).rejects.toMatchObject({ code: 'unavailable' });
    expect((await listProjectVersions('owner', 'p')).items).toHaveLength(0);
    await env.DB.prepare('DROP TRIGGER fail_versions').run();
    const [v, again] = await Promise.all([create(), create()]);
    expect(v).toEqual(again);
    await create('Zweite');
    const page = await listProjectVersions('owner', 'p', { limit: 1 });
    await recordVersionBuild('owner', 'p', v.id, build(), 0, 'new-build');
    await expect(
      listProjectVersions('owner', 'p', { limit: 1, cursor: page.nextCursor }),
    ).rejects.toMatchObject({ code: 'conflict' });
    const results = await Promise.allSettled(
      ['one', 'two'].map((key) =>
        recordVersionBuild('owner', 'p', v.id, build(), 1, key),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(
      getProjectVersion('owner', 'elsewhere', v.id),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
