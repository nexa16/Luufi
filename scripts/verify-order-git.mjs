import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

class VerificationError extends Error {}
const fail = (message) => {
  throw new VerificationError(message);
};
const bounded = (value, max, name) => {
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
};
const sha = (value) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/i.test(value))
    fail('Ein vollständiger Git-SHA ist erforderlich.');
  return value.toLowerCase();
};
const branch = (value) => {
  bounded(value, 200, 'Branch');
  if (
    value.startsWith('-') ||
    /[\x20~^:?*[\\]/.test(value) ||
    value.includes('..') ||
    value.endsWith('/') ||
    value.endsWith('.lock')
  )
    fail('Der Branchname ist ungültig.');
  return value;
};
const safeLink = (value) => {
  bounded(value, 1000, 'Link');
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    fail('Unsicherer Nachweislink.');
  return value;
};
function githubRepository(value) {
  const pair = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  if (pair.test(value)) return value;
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
        'Der Githelper unterstützt nur GitHub-Repositories ohne eingebettete Zugangsdaten.',
      );
    const name = u.pathname
      .replace(/^\//, '')
      .replace(/\/$/, '')
      .replace(/\.git$/, '');
    if (!pair.test(name))
      fail('Die GitHub-Adresse muss ein Repository bezeichnen.');
    return name;
  } catch (error) {
    if (error instanceof VerificationError) throw error;
    fail(
      'Der Githelper unterstützt owner/name oder eine vollständige GitHub-HTTPS-Adresse.',
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
        GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0',
        GH_PROMPT_DISABLED: '1',
        GIT_NO_REPLACE_OBJECTS: '1',
      },
    }).trim();
  } catch {
    fail(
      'Die schreibgeschützte Git-/GitHub-Prüfung konnte nicht abgeschlossen werden.',
    );
  }
}
const git = (cwd, args) =>
  run(
    'git',
    ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args],
    cwd,
  );
function ancestor(cwd, commit, head) {
  try {
    git(cwd, ['merge-base', '--is-ancestor', sha(commit), sha(head)]);
    return true;
  } catch {
    return false;
  }
}
async function defaultPlatform(endpoint, cwd) {
  let value;
  try {
    value = JSON.parse(run('gh', ['api', endpoint], cwd));
  } catch {
    fail('Die schreibgeschützte GitHub-Abfrage ist nicht verfügbar.');
  }
  return value;
}
function collection(value, key) {
  if (
    !value ||
    !Array.isArray(value[key]) ||
    value[key].length > 100 ||
    !Number.isSafeInteger(value.total_count) ||
    value.total_count > 100
  )
    fail(
      'Die Plattformantwort ist unvollständig oder überschreitet die sichere Prüfgrenze.',
    );
  return value[key];
}

/** Read-only local inspection plus current GitHub facts. No checkout, fetch,
 * hooks, PR programs, shell command strings, remote helpers or build execution.
 * readPlatform is an explicit fixture adapter; the CLI always uses gh api. */
export async function verifyOrderGit(
  options,
  { readPlatform = defaultPlatform } = {},
) {
  if (!options || typeof options !== 'object') fail('Prüfparameter fehlen.');
  const cwd = path.resolve(bounded(options.cwd, 4000, 'Repositorypfad'));
  const repository = bounded(options.repository, 1000, 'Repository');
  const apiRepository = githubRepository(repository).toLowerCase();
  const orderId = bounded(options.orderId, 100, 'Auftragskennung');
  if (!/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(orderId))
    fail('Die Auftragskennung ist ungültig.');
  const workBranch = branch(options.branch),
    integrationBranch = branch(options.integrationBranch ?? 'develop'),
    commitSha = sha(options.commitSha);
  const ref = `refs/heads/${workBranch}`;
  const headSha = sha(git(cwd, ['rev-parse', '--verify', `${ref}^{commit}`]));
  const commitSubject = bounded(
    git(cwd, ['show', '-s', '--format=%s', commitSha]),
    1000,
    'Commitbetreff',
  );
  const parentShas = git(cwd, ['show', '-s', '--format=%P', commitSha])
    .split(' ')
    .filter(Boolean)
    .map(sha);
  const idPattern = new RegExp(
    `(^|[^A-Za-z0-9_-])${orderId}(?=$|[^A-Za-z0-9_-])`,
  );
  if (!idPattern.test(commitSubject) || parentShas.length > 1)
    fail(
      'Der Auftragscommit fehlt, trägt eine andere Kennung oder ist ein Mergecommit.',
    );
  if (!ancestor(cwd, commitSha, headSha))
    fail('Der Auftragscommit ist nicht im angegebenen Branch enthalten.');
  const prefix = `repos/${apiRepository.split('/').map(encodeURIComponent).join('/')}`;
  const remote = await readPlatform(
    `${prefix}/branches/${encodeURIComponent(workBranch)}`,
    cwd,
  );
  const remoteHead = sha(remote?.commit?.sha);
  if (headSha !== remoteHead)
    fail(
      'Der lokale Branchstand entspricht nicht dem aktuellen Remote-Branch. Aktualisiere ihn separat und prüfe erneut.',
    );
  // The fetched local graph must contain the current remote SHA; stale/missing
  // objects fail rather than triggering a fetch or claiming a pushed commit.
  if (!ancestor(cwd, commitSha, remoteHead))
    fail(
      'Der Auftragscommit ist nicht im aktuell beobachteten Remote-Branch enthalten. Aktualisiere den lokalen Gitstand separat.',
    );
  let pr = null,
    ci = [];
  const mergeBase = sha(
    git(cwd, [
      'merge-base',
      commitSha,
      `refs/remotes/origin/${integrationBranch}`,
    ]),
  );
  const range = `${mergeBase}..${headSha}`;
  const candidateLines = git(cwd, [
    'log',
    '--no-merges',
    '--format=%H%x09%s',
    range,
  ])
    .split('\n')
    .filter(Boolean);
  const candidates = candidateLines
    .filter((line) => idPattern.test(line.split('\t').slice(1).join('\t')))
    .map((line) => line.split('\t')[0]);
  // During integration the commit may already be an ancestor of origin/develop;
  // inspect its own ancestry only when the bounded branch range is empty.
  if (mergeBase === commitSha) {
    if (workBranch !== integrationBranch)
      fail(
        'Der Auftragscommit ist bereits integriert; prüfe den Integrationsbranch.',
      );
  } else if (candidates.length !== 1 || candidates[0] !== commitSha)
    fail(
      'Die Arbeitsbranchhistorie muss genau einen finalen Commit für den Auftrag enthalten.',
    );
  if (options.prNumber !== undefined) {
    if (!Number.isSafeInteger(options.prNumber) || options.prNumber < 1)
      fail('Die Pull-Request-Nummer ist ungültig.');
    const data = await readPlatform(`${prefix}/pulls/${options.prNumber}`, cwd);
    const prHead = sha(data?.head?.sha),
      mergeSha =
        data?.merge_commit_sha === null ? null : sha(data?.merge_commit_sha);
    if (
      data?.base?.repo?.full_name?.toLowerCase() !== apiRepository ||
      data?.head?.repo?.full_name?.toLowerCase() !== apiRepository ||
      data?.base?.ref !== integrationBranch
    )
      fail(
        'Der Pull Request gehört nicht zum konfigurierten Repository und Integrationsbranch.',
      );
    if (!ancestor(cwd, commitSha, prHead))
      fail('Der Pull Request enthält den ursprünglichen Auftragscommit nicht.');
    let normalMerge = false;
    if (data.merged === true && mergeSha) {
      const parents = git(cwd, ['show', '-s', '--format=%P', mergeSha])
        .split(' ')
        .filter(Boolean)
        .map(sha);
      normalMerge =
        parents.length === 2 &&
        parents[1] === prHead &&
        ancestor(cwd, mergeSha, headSha);
      if (normalMerge) {
        const commits = git(cwd, [
          'log',
          '--no-merges',
          '--format=%H%x09%s',
          `${parents[0]}..${prHead}`,
        ])
          .split('\n')
          .filter((line) =>
            idPattern.test(line.split('\t').slice(1).join('\t')),
          )
          .map((line) => line.split('\t')[0]);
        if (commits.length !== 1 || commits[0] !== commitSha)
          fail(
            'Der integrierte PR muss genau den einen finalen Auftragscommit erhalten.',
          );
      }
    }
    if (
      data.merged === true &&
      (!normalMerge || workBranch !== integrationBranch)
    )
      fail(
        'Integration muss den ursprünglichen Auftragscommit durch normalen PR-Merge im Integrationsbranch erhalten.',
      );
    pr = {
      url: safeLink(data.html_url),
      baseBranch: branch(data.base.ref),
      headSha: prHead,
      merged: data.merged === true,
      mergeSha,
      normalMerge,
    };
    const checks = collection(
      await readPlatform(
        `${prefix}/commits/${prHead}/check-runs?per_page=100`,
        cwd,
      ),
      'check_runs',
    );
    const runs = collection(
      await readPlatform(
        `${prefix}/actions/runs?head_sha=${prHead}&per_page=100`,
        cwd,
      ),
      'workflow_runs',
    );
    const current = new Map();
    for (const item of [
      ...checks.map((check) => ({
        url: check.html_url,
        name: check.name,
        headSha: check.head_sha,
        conclusion: check.conclusion,
        status: check.status,
        id: check.id,
        group: `check:${check.app?.id ?? ''}:${check.name}`,
      })),
      ...runs.map((run) => ({
        url: run.html_url,
        name: run.name,
        headSha: run.head_sha,
        conclusion: run.conclusion,
        status: run.status,
        id: run.id,
        group: `workflow:${run.workflow_id ?? ''}`,
      })),
    ]) {
      if (sha(item.headSha) !== prHead) continue;
      const conclusion =
        item.status !== 'completed'
          ? 'pending'
          : item.conclusion === 'success'
            ? 'success'
            : item.conclusion === 'cancelled'
              ? 'cancelled'
              : 'failure';
      const next = {
        url: safeLink(item.url),
        name: bounded(item.name, 200, 'CI-Name'),
        headSha: prHead,
        conclusion,
      };
      if (!Number.isSafeInteger(item.id) || item.id < 0)
        fail('Die CI-Zuordnung ist ungültig.');
      if (!current.has(item.group) || current.get(item.group).id < item.id)
        current.set(item.group, { id: item.id, value: next });
    }
    ci = [...current.values()].map((v) => v.value);
    if (ci.length > 50)
      fail('Höchstens 50 aktuelle CI-Fakten dürfen gespeichert werden.');
    if (
      pr.merged &&
      (!ci.length || ci.some((item) => item.conclusion !== 'success'))
    )
      fail(
        'Für den integrierten PR-Head liegt keine vollständig erfolgreiche aktuelle CI vor.',
      );
  }
  if (workBranch === integrationBranch && !pr?.merged)
    fail(
      'Ein Integrationsnachweis benötigt einen tatsächlich gemergten Pull Request.',
    );
  return {
    repository,
    branch: workBranch,
    remoteRef: `origin/${workBranch}`,
    headSha,
    commitSha,
    observedAt: new Date().toISOString(),
    source: 'codex-local-git',
    commitSubject,
    parentShas,
    ancestorOfHead: true,
    pushed: true,
    pr,
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
      if (input.length > 16384) fail('Die Prüfparameter sind zu groß.');
    }
    const result = await verifyOrderGit(JSON.parse(input));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof VerificationError ? error.message : 'Die Gitprüfung ist fehlgeschlagen; bitte Parameter und Repositoryzugriff prüfen.'}\n`,
    );
    process.exitCode = 1;
  }
}
