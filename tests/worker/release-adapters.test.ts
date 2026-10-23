import { env } from 'cloudflare:workers';
import { afterEach, expect, it } from 'vitest';
import { dispatchMcp } from '@/lib/mcp/route';
import type {
  BootstrapProof,
  BootstrapStatus,
  BuildRecord,
  ProjectVersion,
} from '@/lib/domain/releases';
import type { Project } from '@/lib/domain/planning';
import { GET as versions } from '@/app/api/projects/[projectId]/versions/route';
import { GET as version } from '@/app/api/projects/[projectId]/versions/[versionId]/route';
import { GET as orders } from '@/app/api/projects/[projectId]/versions/[versionId]/orders/route';
import { GET as builds } from '@/app/api/projects/[projectId]/versions/[versionId]/builds/route';
import { GET as releases } from '@/app/api/projects/[projectId]/versions/[versionId]/releases/route';
import { GET as latest } from '@/app/api/projects/[projectId]/latest-available-version/route';
import { GET as provenance } from '@/app/api/projects/[projectId]/orders/[orderId]/bootstrap-provenance/route';

const headers = {
  'content-type': 'application/json',
  'oai-authenticated-user-id': 'owner',
};
async function call<T>(name: string, args: unknown): Promise<T> {
  const response = await dispatchMcp(
    new Request('https://luufi.test/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args, _meta: { actor: 'spoofed' } },
      }),
    }),
    { ...env, LUUFI_ENVIRONMENT: 'production' },
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    result: { isError?: boolean; content: { text: string }[] };
  };
  const value = JSON.parse(body.result.content[0].text);
  if (body.result.isError)
    throw Object.assign(new Error(value.error), { code: value.code });
  return value;
}
const proofs: BootstrapProof[] = Array.from({ length: 18 }, (_, index) => ({
  number: index + 1,
  kind: index ? 'public-git' : 'sites-proof',
  implementationCommit: index ? 'b'.repeat(40) : null,
  integrationCommit: index ? 'c'.repeat(40) : null,
  prUrl: index ? 'https://github.com/nexa16/Luufi/pull/1' : null,
  ciUrl: index ? 'https://github.com/nexa16/Luufi/actions/runs/1' : null,
  sourceCommit: 'a'.repeat(40),
  verificationReference: 'Synthetischer Adaptertest, keine Livebeobachtung',
  verifiedAt: '2026-01-01T12:00:00.000Z',
}));
afterEach(async () => {
  await env.DB.batch(
    [
      'version_releases',
      'version_builds',
      'version_orders',
      'project_versions',
      'bootstrap_provenance',
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
    ].map((t) => env.DB.prepare('DELETE FROM ' + t)),
  );
});

it('LUUFI-16/18 verbindet natives festes Bootstrap, unveränderliche Version und authentifizierte Browserbelege', async () => {
  expect(await call('bootstrap_status', {})).toMatchObject({
    installedCount: 0,
    complete: false,
  });
  const input = {
    proofs,
    confirmationReference: 'Synthetische Gesamtfreigabe',
    requestKey: 'bootstrap',
  };
  const installed = await call<BootstrapStatus>('bootstrap_reconcile', input);
  expect(installed).toMatchObject({
    expectedCount: 18,
    installedCount: 18,
    complete: true,
  });
  expect(await call('bootstrap_reconcile', input)).toEqual(installed);
  const project = await call<Project>('projects_get', {
    id: installed.projectId,
  });
  const result = await call<ProjectVersion>('versions_create', {
    projectId: project.id,
    expectedPlanningRevision: project.planningRevision,
    requestKey: 'version',
    input: {
      label: 'Testvorschau',
      channel: 'develop',
      title: 'Grundlage',
      changelog: 'Geschützte Grundlage verfügbar.',
      repositoryCommit: 'c'.repeat(40),
      sourceBranch: 'develop',
      scope: { mode: 'selection', orderIds: ['bootstrap-luufi-order-2'] },
    },
  });
  expect(result).toMatchObject({ orderCount: 1, revision: 0, releaseId: null });
  const entity = { projectId: project.id, id: result.id };
  expect(await call('versions_get', entity)).toEqual(result);
  expect(await call('versions_orders', entity)).toMatchObject({
    items: [
      {
        displayId: 'LUUFI-2',
        provenanceKind: 'bootstrap',
        implementationId: null,
      },
    ],
  });
  expect(
    await call('versions_list', { projectId: project.id, limit: 1 }),
  ).toMatchObject({ items: [result], nextCursor: null });
  expect(
    await call('versions_latest_available', { projectId: project.id }),
  ).toBeNull();
  const buildInput = {
    kind: 'site',
    outcome: 'available',
    url: 'https://example.invalid/private-preview',
    reason: '',
    environment: 'preview',
    projectCommit: 'c'.repeat(40),
    sourceKind: 'sites',
    sourceBranch: 'main',
    sourceCommit: 'd'.repeat(40),
    versionCommitIncluded: true,
    mappingReference: 'Synthetischer Sourcespiegel',
    observedAt: '2026-01-02T12:00:00.000Z',
    verificationReference: 'Synthetischer Healthcheck',
  };
  const build = await call<BuildRecord>('versions_build_record', {
    ...entity,
    input: buildInput,
    expectedRevision: 0,
    requestKey: 'build',
  });
  expect(await call('versions_builds', entity)).toMatchObject({
    items: [build],
  });
  expect(await call('versions_releases', entity)).toEqual({
    items: [],
    nextCursor: null,
  });
  expect(
    await call('versions_latest_available', { projectId: project.id }),
  ).toMatchObject({ version: { id: result.id }, build });
  expect(
    await call('orders_bootstrap_provenance', {
      projectId: project.id,
      id: 'bootstrap-luufi-order-2',
    }),
  ).toMatchObject({ displayId: 'LUUFI-2', kind: 'public-git' });
  await expect(
    call('versions_build_record', {
      ...entity,
      input: { ...buildInput, versionCommitIncluded: 'true' },
      expectedRevision: 1,
      requestKey: 'bad-boolean',
    }),
  ).rejects.toMatchObject({ code: 'validation' });
  await expect(
    call('bootstrap_reconcile', { ...input, projectId: 'another' }),
  ).rejects.toMatchObject({ code: 'validation' });
  const params = Promise.resolve({
    projectId: project.id,
    versionId: result.id,
    orderId: 'bootstrap-luufi-order-2',
  });
  for (const read of [
    versions,
    version,
    orders,
    builds,
    releases,
    latest,
    provenance,
  ]) {
    const unauthorized = await read(new Request('https://luufi.test/api'), {
      params,
    });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('cache-control')).toBe('no-store');
    const response = await read(
      new Request('https://luufi.test/api?limit=1', { headers }),
      { params },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
  }
  const response = await latest(
    new Request('https://luufi.test/api', { headers }),
    { params },
  );
  expect(await response.json()).toMatchObject({
    version: { id: result.id },
    build: { sourceCommit: 'd'.repeat(40), projectCommit: 'c'.repeat(40) },
  });
  const other = await call<Project>('projects_register', {
    key: 'OTHER',
    name: 'Anderes Projekt',
    repository: 'example/other',
    requestKey: 'other',
  });
  await expect(
    call('versions_get', { projectId: other.id, id: result.id }),
  ).rejects.toMatchObject({ code: 'not_found' });
  await expect(
    call('orders_bootstrap_provenance', {
      projectId: other.id,
      id: 'bootstrap-luufi-order-2',
    }),
  ).rejects.toMatchObject({ code: 'not_found' });
});

it('LUUFI-16 validiert Releaseparameter im nativen Vertrag bevor ein Beleg geschrieben wird', async () => {
  await expect(
    call('versions_release_record', {
      projectId: 'p',
      id: 'v',
      expectedRevision: 0,
      requestKey: 'release',
      input: { confirmationReference: 'Nicht vollständig' },
    }),
  ).rejects.toMatchObject({ code: 'validation' });
});
