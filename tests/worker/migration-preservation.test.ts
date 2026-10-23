import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { platformReadiness } from '@/lib/services/deployment-identity';

it('LUUFI-3 preserves legacy IDs, text, details and dates while adding revision zero', async () => {
  const legacy = env.TEST_MIGRATIONS.filter(
    (m) => Number(m.name.slice(0, 4)) < 5,
  );
  const additive = env.TEST_MIGRATIONS.filter(
    (m) => Number(m.name.slice(0, 4)) >= 5,
  );
  expect(additive.map((m) => m.name)).toEqual(
    expect.arrayContaining([
      '0005_ideas_revisions.sql',
      '0006_planning.sql',
      '0007_feedback.sql',
    ]),
  );
  await applyD1Migrations(env.LEGACY_DB, legacy);
  expect(await platformReadiness({ ...env, DB: env.LEGACY_DB })).toEqual({
    status: 'unavailable',
  });
  const records = [
    {
      id: 'legacy-a',
      idea_text: 'Eine bestehende Idee',
      detail: 'Unveränderte Details mit ö und 😀',
      created_at: 1700000000123,
    },
    {
      id: 'legacy-b',
      idea_text: 'Zweite Idee',
      detail: '',
      created_at: 1700000000456,
    },
  ];
  for (const row of records)
    await env.LEGACY_DB.prepare(
      'INSERT INTO project_ideas (id,idea_text,detail,created_at) VALUES (?,?,?,?)',
    )
      .bind(row.id, row.idea_text, row.detail, row.created_at)
      .run();
  await applyD1Migrations(env.LEGACY_DB, additive);
  expect(await platformReadiness({ ...env, DB: env.LEGACY_DB })).toMatchObject({
    status: 'ok',
  });
  const restored = await env.LEGACY_DB.prepare(
    'SELECT id,idea_text,detail,created_at,revision FROM project_ideas ORDER BY id',
  ).all();
  expect(restored.results).toEqual(
    records.map((row) => ({ ...row, revision: 0 })),
  );
  const tables = await env.LEGACY_DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table'",
  ).all<{ name: string }>();
  expect(tables.results.map((row) => row.name)).toEqual(
    expect.arrayContaining([
      'oauth_sessions',
      'oauth_states',
      'mutation_operations',
      'project_snapshots',
      'project_ideas',
      'idea_mutation_requests',
    ]),
  );
});
