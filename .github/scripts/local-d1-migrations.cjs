/* oxlint-disable typescript/no-require-imports -- Node executes this wrapper directly as CommonJS. */
const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_FILE = path.join(REPOSITORY_ROOT, 'wrangler.local.jsonc');
const DEFAULT_PERSISTENCE_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  '.wrangler',
  'state',
);

function resolveWranglerBinary(resolveModule = require.resolve) {
  try {
    // Resolve the exported package manifest; newer Wrangler versions hide bin
    // subpaths from package exports while retaining the declared executable.
    return path.join(
      path.dirname(resolveModule('wrangler/package.json')),
      'bin',
      'wrangler.js',
    );
  } catch (error) {
    throw new Error(
      'The installed Wrangler binary could not be found. Run pnpm install before applying local D1 migrations.',
      { cause: error },
    );
  }
}

function localMigrationCommand({
  persistenceDirectory = DEFAULT_PERSISTENCE_DIRECTORY,
  resolveModule,
} = {}) {
  return {
    executable: process.execPath,
    arguments: [
      resolveWranglerBinary(resolveModule),
      'd1',
      'migrations',
      'apply',
      'DB',
      '--local',
      '--config',
      CONFIG_FILE,
      '--persist-to',
      persistenceDirectory,
    ],
  };
}

function applyLocalD1Migrations({
  environment = process.env,
  persistenceDirectory = DEFAULT_PERSISTENCE_DIRECTORY,
  resolveModule,
  spawn = spawnSync,
} = {}) {
  if (!existsSync(CONFIG_FILE)) {
    throw new Error(`Local Wrangler configuration is missing: ${CONFIG_FILE}`);
  }

  const command = localMigrationCommand({
    persistenceDirectory,
    resolveModule,
  });
  const result = spawn(command.executable, command.arguments, {
    cwd: REPOSITORY_ROOT,
    env: { ...environment, CI: 'true' },
    stdio: 'inherit',
  });

  if (result.error) {
    throw new Error(
      `Wrangler could not start: ${result.error.message}. Run pnpm install, then retry npm run db:migrate:local.`,
      { cause: result.error },
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `Wrangler exited with status ${String(result.status)}. Fix the migration error above, then retry npm run db:migrate:local.`,
    );
  }
}

function runCli({
  logError = console.error,
  processState = process,
  ...options
} = {}) {
  try {
    applyLocalD1Migrations(options);
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logError(`Local D1 migrations failed. ${detail}`);
    processState.exitCode = 1;
    return false;
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  CONFIG_FILE,
  DEFAULT_PERSISTENCE_DIRECTORY,
  REPOSITORY_ROOT,
  applyLocalD1Migrations,
  localMigrationCommand,
  resolveWranglerBinary,
  runCli,
};
