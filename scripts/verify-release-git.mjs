import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { devNull } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
class VerificationError extends Error {}
const fail = (message) => {
  throw new VerificationError(message);
};
function text(value, max, name) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    Array.from(value).some(
      (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
    )
  )
    fail(`${name} ist ungültig.`);
  return value;
}
function sha(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/i.test(value))
    fail('Ein vollständiger Git-SHA ist erforderlich.');
  return value.toLowerCase();
}
function ref(value) {
  text(value, 200, 'Branch oder Tag');
  if (
    value.startsWith('-') ||
    value.includes('..') ||
    value.includes('@{') ||
    /[\x20~^:?*[\\]/.test(value) ||
    value.endsWith('/') ||
    value.endsWith('.lock')
  )
    fail('Der Branch oder Tag ist ungültig.');
  return value;
}
function link(value) {
  text(value, 1000, 'CI-Link');
  try {
    const u = new URL(value);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password)
      fail('Der CI-Link ist unsicher.');
  } catch (error) {
    if (error instanceof VerificationError) throw error;
    fail('Der CI-Link ist ungültig.');
  }
  return value;
}
function repositoryName(value) {
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value))
    return value.toLowerCase();
  try {
    const u = new URL(value);
    if (
      u.protocol !== 'https:' ||
      u.hostname !== 'github.com' ||
      u.port ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      fail(
        'Der Releasehelper unterstützt ausschließlich GitHub ohne eingebettete Zugangsdaten.',
      );
    const name = u.pathname
      .replace(/^\//, '')
      .replace(/\/$/, '')
      .replace(/\.git$/, '');
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name))
      fail('Die GitHub-Adresse muss ein Repository bezeichnen.');
    return name.toLowerCase();
  } catch (error) {
    if (error instanceof VerificationError) throw error;
    fail(
      'Der Releasehelper unterstützt owner/name oder eine GitHub-HTTPS-Adresse.',
    );
  }
}
function run(binary, args, cwd) {
  try {
    return execFileSync(binary, args, {
      cwd,
      encoding: 'utf8',
      timeout: 20000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_NO_REPLACE_OBJECTS: '1',
        GIT_GRAFT_FILE: devNull,
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        GH_PROMPT_DISABLED: '1',
      },
    }).trim();
  } catch {
    fail(
      'Die schreibgeschützte Git-/GitHub-Releaseprüfung konnte nicht abgeschlossen werden.',
    );
  }
}
const git = (cwd, args) =>
  run(
    'git',
    ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args],
    cwd,
  );
function rejectGrafts(cwd) {
  if (process.env.GIT_GRAFT_FILE !== undefined)
    fail('Die Releaseprüfung erlaubt kein geerbtes GIT_GRAFT_FILE.');
  const directories = git(cwd, [
    'rev-parse',
    '--git-dir',
    '--git-common-dir',
  ]).split('\n');
  if (
    directories.some((directory) =>
      existsSync(path.join(path.resolve(cwd, directory), 'info', 'grafts')),
    )
  )
    fail('Lokale Git-Graftdateien sind für Releaseprüfungen nicht erlaubt.');
}
async function defaultPlatform(endpoint, cwd) {
  try {
    return JSON.parse(
      run('gh', ['api', '--hostname', 'github.com', endpoint], cwd),
    );
  } catch {
    fail('Die schreibgeschützte GitHub-Releaseabfrage ist nicht verfügbar.');
  }
}
function collection(value, key) {
  if (
    !value ||
    !Array.isArray(value[key]) ||
    value[key].length > 100 ||
    !Number.isSafeInteger(value.total_count) ||
    value.total_count !== value[key].length ||
    value.total_count > 100
  )
    fail(
      'Die CI-Antwort ist unvollständig oder überschreitet die sichere Prüfgrenze.',
    );
  return value[key];
}
/** Reads Git objects and GitHub GET endpoints only; never creates/moves tags,
 * checks out code, fetches a remote, runs PR programs, or publishes a release. */
export async function verifyReleaseGit(
  options,
  { readPlatform = defaultPlatform } = {},
) {
  if (
    !options ||
    typeof options !== 'object' ||
    Object.keys(options).some(
      (k) =>
        ![
          'cwd',
          'repository',
          'productionBranch',
          'productionCommit',
          'tag',
          'versionCommit',
        ].includes(k),
    )
  )
    fail('Die Releaseprüfparameter sind ungültig.');
  const cwd = path.resolve(text(options.cwd, 4000, 'Repositorypfad')),
    repository = text(options.repository, 1000, 'Repository'),
    name = repositoryName(repository),
    productionBranch = ref(options.productionBranch),
    productionCommit = sha(options.productionCommit),
    tag = ref(options.tag),
    versionCommit = sha(options.versionCommit),
    prefix = `repos/${name.split('/').map(encodeURIComponent).join('/')}`;
  rejectGrafts(cwd);
  const productionHead = sha(
    git(cwd, [
      'rev-parse',
      '--verify',
      `refs/heads/${productionBranch}^{commit}`,
    ]),
  );
  const remote = await readPlatform(
    `${prefix}/branches/${encodeURIComponent(productionBranch)}`,
    cwd,
  );
  if (
    productionHead !== productionCommit ||
    sha(remote?.commit?.sha) !== productionCommit
  )
    fail(
      'Lokaler und tatsächlicher Remote-Produktionsbranch müssen exakt dem freigegebenen Produktionscommit entsprechen.',
    );
  try {
    git(cwd, ['merge-base', '--is-ancestor', versionCommit, productionCommit]);
  } catch {
    fail('Der Versionscommit ist nicht im Produktionscommit enthalten.');
  }
  const tagCommit = sha(
    git(cwd, ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]),
  );
  if (tagCommit !== productionCommit)
    fail('Der lokale Tag zeigt auf einen anderen Produktionscommit.');
  let tagObject = await readPlatform(
    `${prefix}/git/ref/tags/${encodeURIComponent(tag)}`,
    cwd,
  );
  let object = tagObject?.object;
  for (let depth = 0; object?.type === 'tag'; depth++) {
    if (depth >= 4)
      fail('Die Tagverschachtelung überschreitet die sichere Prüfgrenze.');
    tagObject = await readPlatform(
      `${prefix}/git/tags/${sha(object.sha)}`,
      cwd,
    );
    object = tagObject?.object;
  }
  if (object?.type !== 'commit' || sha(object.sha) !== productionCommit)
    fail(
      'Der tatsächliche Remote-Tag zeigt auf einen anderen Produktionscommit.',
    );
  const checks = collection(
      await readPlatform(
        `${prefix}/commits/${productionCommit}/check-runs?per_page=100`,
        cwd,
      ),
      'check_runs',
    ),
    runs = collection(
      await readPlatform(
        `${prefix}/actions/runs?head_sha=${productionCommit}&per_page=100`,
        cwd,
      ),
      'workflow_runs',
    );
  const current = new Map();
  for (const item of [
    ...checks.map((c) => ({
      id: c.id,
      group: `check:${c.app?.id ?? ''}:${c.name}`,
      url: c.html_url,
      name: c.name,
      headSha: c.head_sha,
      status: c.status,
      conclusion: c.conclusion,
    })),
    ...runs.map((r) => ({
      id: r.id,
      group: `workflow:${r.workflow_id ?? ''}`,
      url: r.html_url,
      name: r.name,
      headSha: r.head_sha,
      status: r.status,
      conclusion: r.conclusion,
    })),
  ]) {
    if (sha(item.headSha) !== productionCommit) continue;
    if (!Number.isSafeInteger(item.id) || item.id < 0)
      fail('Die CI-Zuordnung ist ungültig.');
    const value = {
      url: link(item.url),
      name: text(item.name, 200, 'CI-Name'),
      headSha: productionCommit,
      conclusion:
        item.status !== 'completed'
          ? 'pending'
          : item.conclusion === 'success'
            ? 'success'
            : item.conclusion === 'cancelled'
              ? 'cancelled'
              : 'failure',
    };
    if (!current.has(item.group) || current.get(item.group).id < item.id)
      current.set(item.group, { id: item.id, value });
  }
  const ci = [...current.values()].map((v) => v.value);
  if (
    !ci.length ||
    ci.length > 50 ||
    ci.some((c) => c.conclusion !== 'success')
  )
    fail(
      'Der Produktionscommit benötigt vollständig erfolgreiche aktuelle CI innerhalb der sicheren Prüfgrenze.',
    );
  return {
    repository,
    productionBranch,
    productionHead,
    tag,
    tagCommit,
    versionCommit,
    versionCommitIncluded: true,
    observedAt: new Date().toISOString(),
    source: 'codex-local-git',
    ci,
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 16384) fail('Die Releaseprüfparameter sind zu groß.');
    }
    process.stdout.write(
      `${JSON.stringify(await verifyReleaseGit(JSON.parse(input)), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof VerificationError ? error.message : 'Die Releaseprüfung ist fehlgeschlagen; bitte Parameter und Repositoryzugriff prüfen.'}\n`,
    );
    process.exitCode = 1;
  }
}
