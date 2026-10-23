/// <reference types="node" />

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const migrations = require('./local-d1-migrations.cjs') as {
  CONFIG_FILE: string;
  REPOSITORY_ROOT: string;
  applyLocalD1Migrations(options?: Record<string, unknown>): void;
  localMigrationCommand(options?: Record<string, unknown>): {
    executable: string;
    arguments: string[];
  };
  resolveWranglerBinary(resolveModule?: (request: string) => string): string;
  runCli(options?: Record<string, unknown>): boolean;
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function disposablePersistenceDirectory() {
  const directory = mkdtempSync(path.join(tmpdir(), 'luufi-d1-'));
  temporaryDirectories.push(directory);
  return directory;
}

function executeLocalSql(persistenceDirectory: string, sql: string) {
  const wranglerBinary = migrations.resolveWranglerBinary();
  const result = spawnSync(
    process.execPath,
    [
      wranglerBinary,
      'd1',
      'execute',
      'DB',
      '--local',
      '--config',
      migrations.CONFIG_FILE,
      '--persist-to',
      persistenceDirectory,
      '--command',
      sql,
      '--json',
    ],
    {
      cwd: migrations.REPOSITORY_ROOT,
      env: { ...process.env, CI: 'true' },
      encoding: 'utf8',
    },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Wrangler SQL failed.');
  }
  return JSON.parse(result.stdout) as Array<{
    results: Array<Record<string, unknown>>;
  }>;
}

describe('local D1 migration wrapper', () => {
  it('LUUFI-2 F-5 invokes the installed Wrangler CLI with the shared local state and isolated CI environment', () => {
    const spawn = vi.fn().mockReturnValue({ status: 0 });
    const environment = { LUUFI_TEST_MARKER: 'preserved', CI: 'parent-value' };
    const persistenceDirectory = path.join('C:', 'temporary', 'd1-state');
    const wranglerBinary = path.join(
      'C:',
      'node_modules',
      'wrangler',
      'bin',
      'wrangler.js',
    );

    migrations.applyLocalD1Migrations({
      environment,
      persistenceDirectory,
      resolveModule: vi
        .fn()
        .mockReturnValue(
          path.join('C:', 'node_modules', 'wrangler', 'package.json'),
        ),
      spawn,
    });

    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [
        wranglerBinary,
        'd1',
        'migrations',
        'apply',
        'DB',
        '--local',
        '--config',
        migrations.CONFIG_FILE,
        '--persist-to',
        persistenceDirectory,
      ],
      {
        cwd: migrations.REPOSITORY_ROOT,
        env: {
          LUUFI_TEST_MARKER: 'preserved',
          CI: 'true',
        },
        stdio: 'inherit',
      },
    );
    expect(environment.CI).toBe('parent-value');
  });

  it('LUUFI-2 F-5 aborts with actionable output when Wrangler cannot be resolved', () => {
    const resolutionFailure = new Error('module missing');
    const resolveModule = vi.fn(() => {
      throw resolutionFailure;
    });

    expect(() => migrations.resolveWranglerBinary(resolveModule)).toThrow(
      'Run pnpm install',
    );
  });

  it.each([
    [{ error: new Error('spawn denied') }, 'Wrangler could not start'],
    [{ status: 1 }, 'Wrangler exited with status 1'],
  ])(
    'LUUFI-2 F-5 aborts startup for a failed migration subprocess %#',
    (result, expected) => {
      expect(() =>
        migrations.applyLocalD1Migrations({
          resolveModule: vi.fn().mockReturnValue('wrangler.js'),
          spawn: vi.fn().mockReturnValue(result),
        }),
      ).toThrow(expected);
    },
  );

  it('LUUFI-2 F-5 reports a clear nonzero CLI result without throwing past the entry point', () => {
    const logError = vi.fn();
    const processState = { exitCode: 0 };

    const succeeded = migrations.runCli({
      logError,
      processState,
      resolveModule: vi.fn().mockReturnValue('wrangler.js'),
      spawn: vi.fn().mockReturnValue({ status: 2 }),
    });

    expect(succeeded).toBe(false);
    expect(processState.exitCode).toBe(1);
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('Local D1 migrations failed.'),
    );
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('npm run db:migrate:local'),
    );
  });

  it('LUUFI-2 F-5 applies every migration once and preserves existing local data', () => {
    const persistenceDirectory = disposablePersistenceDirectory();

    migrations.applyLocalD1Migrations({ persistenceDirectory });
    const schema = executeLocalSql(
      persistenceDirectory,
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;",
    )[0].results.map((row) => row.name);
    expect(schema).toEqual(
      expect.arrayContaining([
        'd1_migrations',
        'project_ideas',
        'project_change_events',
        'project_snapshots',
      ]),
    );

    executeLocalSql(
      persistenceDirectory,
      "INSERT INTO project_ideas (id, idea_text, detail, created_at) VALUES ('defect-57-marker', 'Preserve me', '', 57);",
    );
    migrations.applyLocalD1Migrations({ persistenceDirectory });

    const marker = executeLocalSql(
      persistenceDirectory,
      "SELECT id, idea_text, created_at FROM project_ideas WHERE id = 'defect-57-marker';",
    )[0].results;
    const ledger = executeLocalSql(
      persistenceDirectory,
      'SELECT name FROM d1_migrations ORDER BY id;',
    )[0].results;

    expect(marker).toEqual([
      {
        id: 'defect-57-marker',
        idea_text: 'Preserve me',
        created_at: 57,
      },
    ]);
    expect(ledger.map((row) => row.name)).toEqual([
      '0000_supreme_harrier.sql',
      '0001_third_miss_america.sql',
      '0002_sour_plazm.sql',
      '0003_previous_moira_mactaggert.sql',
      '0004_mcp_probe.sql',
      '0005_ideas_revisions.sql',
    ]);
  }, 30_000);
});
