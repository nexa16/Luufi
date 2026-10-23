import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// Plain ESM helper is also invoked directly by Codex outside the app runtime.
import { verifyOrderGit } from './verify-order-git.mjs';
const directories: string[] = [];
const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Synthetic Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      ...args,
    ],
    {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ).trim();
function fixture(extraId?: string) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'luufi-git-evidence-'));
  directories.push(cwd);
  git(cwd, 'init', '-b', 'develop');
  writeFileSync(path.join(cwd, 'readme.txt'), 'Synthetic base\n');
  git(cwd, 'add', 'readme.txt');
  git(cwd, 'commit', '-m', 'chore: base');
  const base = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'update-ref', 'refs/remotes/origin/develop', base);
  git(cwd, 'checkout', '-b', 'codex/test');
  if (extraId) {
    writeFileSync(path.join(cwd, 'early.txt'), 'Earlier candidate');
    git(cwd, 'add', 'early.txt');
    git(cwd, 'commit', '-m', `feat(${extraId}): earlier`);
  }
  writeFileSync(path.join(cwd, 'feature.txt'), 'Synthetic implementation');
  git(cwd, 'add', 'feature.txt');
  git(cwd, 'commit', '-m', 'feat(APP-1): final implementation');
  const commit = git(cwd, 'rev-parse', 'HEAD');
  return { cwd, base, commit };
}
function merge(f: ReturnType<typeof fixture>, mode = 'normal') {
  git(f.cwd, 'checkout', 'develop');
  if (mode === 'squash') {
    git(f.cwd, 'merge', '--squash', 'codex/test');
    git(f.cwd, 'commit', '-m', 'feat(APP-1): squash');
  } else {
    git(f.cwd, 'merge', '--no-ff', 'codex/test', '-m', 'Merge approved branch');
  }
  git(
    f.cwd,
    'update-ref',
    'refs/remotes/origin/develop',
    git(f.cwd, 'rev-parse', 'HEAD'),
  );
  return git(f.cwd, 'rev-parse', 'HEAD');
}
type FactOptions = {
  merged?: boolean;
  mergeSha?: string;
  ci?: string;
  checks?: unknown[];
  total?: number;
  prHead?: string;
  repository?: string;
};
function platform(f: ReturnType<typeof fixture>, options: FactOptions = {}) {
  return async (endpoint: string) => {
    if (endpoint.includes('/branches/')) {
      const branch = decodeURIComponent(endpoint.split('/branches/')[1]);
      return {
        commit: { sha: git(f.cwd, 'rev-parse', `refs/heads/${branch}`) },
      };
    }
    if (endpoint.endsWith('/pulls/7'))
      return {
        html_url: 'https://github.com/owner/repo/pull/7',
        head: {
          sha: options.prHead ?? f.commit,
          repo: { full_name: options.repository ?? 'owner/repo' },
        },
        base: { ref: 'develop', repo: { full_name: 'owner/repo' } },
        merged: options.merged ?? false,
        merge_commit_sha: options.mergeSha ?? null,
      };
    if (endpoint.includes('/check-runs'))
      return {
        total_count: options.total ?? 1,
        check_runs: options.checks ?? [
          {
            id: 2,
            html_url: 'https://github.com/owner/repo/actions/runs/1/job/2',
            name: 'verify',
            head_sha: options.prHead ?? f.commit,
            status: 'completed',
            conclusion: options.ci ?? 'success',
            app: { id: 1 },
          },
        ],
      };
    if (endpoint.includes('/actions/runs?'))
      return {
        total_count: 1,
        workflow_runs: [
          {
            id: 1,
            workflow_id: 2,
            html_url: 'https://github.com/owner/repo/actions/runs/1',
            name: 'CI',
            head_sha: options.prHead ?? f.commit,
            status: 'completed',
            conclusion: options.ci ?? 'success',
          },
        ],
      };
    throw new Error('Unexpected read-only fixture endpoint');
  };
}
const options = (
  f: ReturnType<typeof fixture>,
  extra: Record<string, unknown> = {},
) => ({
  cwd: f.cwd,
  repository: 'owner/repo',
  branch: 'codex/test',
  commitSha: f.commit,
  orderId: 'APP-1',
  ...extra,
});
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (
      !path
        .resolve(directory)
        .startsWith(path.resolve(os.tmpdir()) + path.sep) ||
      !path.basename(directory).startsWith('luufi-git-evidence-')
    )
      throw new Error('Unsafe fixture cleanup');
    rmSync(directory, { recursive: true, force: true });
  }
});
describe('LUUFI-14 genuine local Git observation', () => {
  it('LUUFI-19 ignores grafts inserted after preflight that would hide an earlier order commit', async () => {
    const f = fixture('APP-1'),
      reader = platform(f);
    await expect(
      verifyOrderGit(options(f), {
        readPlatform: async (endpoint: string) => {
          const result = await reader(endpoint);
          if (endpoint.includes('/branches/'))
            writeFileSync(
              path.join(f.cwd, '.git', 'info', 'grafts'),
              `${f.commit} ${f.base}\n`,
            );
          return result;
        },
      }),
    ).rejects.toThrow('genau einen');
  });
  it.each(['local', 'environment'] as const)(
    'LUUFI-19 rejects %s grafts that hide actual merge parents and forge a final candidate',
    async (mode) => {
      const f = fixture();
      git(f.cwd, 'checkout', 'develop');
      writeFileSync(
        path.join(f.cwd, 'integration.txt'),
        'A genuine integration change',
      );
      git(f.cwd, 'add', 'integration.txt');
      git(f.cwd, 'commit', '-m', 'chore: integration change');
      const integrationHead = git(f.cwd, 'rev-parse', 'HEAD');
      git(f.cwd, 'update-ref', 'refs/remotes/origin/develop', integrationHead);
      git(f.cwd, 'checkout', 'codex/test');
      git(
        f.cwd,
        'merge',
        '--no-ff',
        'develop',
        '-m',
        'feat(APP-1): merge disguised as final',
      );
      const candidate = { ...f, commit: git(f.cwd, 'rev-parse', 'HEAD') };
      expect(
        git(f.cwd, 'show', '-s', '--format=%P', candidate.commit).split(' '),
      ).toHaveLength(2);
      await expect(
        verifyOrderGit(options(candidate), {
          readPlatform: platform(candidate),
        }),
      ).rejects.toThrow('Mergecommit');
      const graft =
        mode === 'local'
          ? path.join(f.cwd, '.git', 'info', 'grafts')
          : path.join(f.cwd, 'external-grafts');
      writeFileSync(graft, `${candidate.commit} ${integrationHead}\n`);
      const previous = process.env.GIT_GRAFT_FILE;
      if (mode === 'environment') process.env.GIT_GRAFT_FILE = graft;
      try {
        await expect(
          verifyOrderGit(options(candidate), {
            readPlatform: platform(candidate),
          }),
        ).rejects.toThrow(mode === 'local' ? 'Graft' : 'GIT_GRAFT_FILE');
      } finally {
        if (previous === undefined) delete process.env.GIT_GRAFT_FILE;
        else process.env.GIT_GRAFT_FILE = previous;
      }
    },
  );
  it('supports a configured GitHub HTTPS repository while retaining its exact configured identity', async () => {
    const f = fixture();
    const reader = platform(f);
    const endpoints: string[] = [];
    const repository = 'https://github.com/Owner/Repo.git';
    const result = await verifyOrderGit(
      options(f, { repository, prNumber: 7 }),
      {
        readPlatform: async (endpoint: string) => {
          endpoints.push(endpoint);
          return reader(endpoint);
        },
      },
    );
    expect(result.repository).toBe(repository);
    expect(
      endpoints.every((endpoint) => endpoint.startsWith('repos/owner/repo/')),
    ).toBe(true);
    await expect(
      verifyOrderGit(
        options(f, { repository: 'https://gitlab.com/owner/repo' }),
        { readPlatform: reader },
      ),
    ).rejects.toThrow('GitHub');
  });
  it('rejects a stale local branch when the actual remote contains a second order commit', async () => {
    const f = fixture();
    writeFileSync(
      path.join(f.cwd, 'later.txt'),
      'A later conflicting candidate',
    );
    git(f.cwd, 'add', 'later.txt');
    git(f.cwd, 'commit', '-m', 'feat(APP-1): another final candidate');
    const remoteHead = git(f.cwd, 'rev-parse', 'HEAD');
    git(f.cwd, 'reset', '--hard', f.commit);
    const reader = platform(f);
    await expect(
      verifyOrderGit(options(f), {
        readPlatform: async (endpoint: string) =>
          endpoint.includes('/branches/')
            ? { commit: { sha: remoteHead } }
            : reader(endpoint),
      }),
    ).rejects.toThrow('Branchstand');
  });
  it('proves the actual commit and remote branch without executing hooks or changing the tree', async () => {
    const f = fixture();
    const marker = path.join(f.cwd, 'executed.txt');
    writeFileSync(
      path.join(f.cwd, '.git', 'hooks', 'post-checkout'),
      `#!/bin/sh\necho executed > "${marker.replaceAll('\\', '/')}"\n`,
    );
    git(f.cwd, 'config', 'core.fsmonitor', `echo executed > ${marker}`);
    const before = git(f.cwd, 'rev-parse', 'HEAD');
    const result = await verifyOrderGit(options(f), {
      readPlatform: platform(f),
    });
    expect(result).toMatchObject({
      repository: 'owner/repo',
      commitSha: f.commit,
      headSha: f.commit,
      source: 'codex-local-git',
      ancestorOfHead: true,
      pushed: true,
      pr: null,
      ci: [],
    });
    expect(result.parentShas).toEqual([f.base]);
    expect(git(f.cwd, 'rev-parse', 'HEAD')).toBe(before);
    expect(existsSync(marker)).toBe(false);
  });
  it('retains the original commit through a normal merge and current successful PR-head CI', async () => {
    const f = fixture(),
      mergeSha = merge(f);
    const result = await verifyOrderGit(
      options(f, { branch: 'develop', prNumber: 7 }),
      { readPlatform: platform(f, { merged: true, mergeSha }) },
    );
    expect(result.pr).toMatchObject({
      normalMerge: true,
      merged: true,
      mergeSha,
      headSha: f.commit,
    });
    expect(result.ci).toHaveLength(2);
    expect(result.headSha).toBe(mergeSha);
  });
  it('rejects a squash integration that lost the original commit', async () => {
    const f = fixture(),
      mergeSha = merge(f, 'squash');
    await expect(
      verifyOrderGit(options(f, { branch: 'develop', prNumber: 7 }), {
        readPlatform: platform(f, { merged: true, mergeSha }),
      }),
    ).rejects.toThrow(/nicht.*enthalten|normalen|ursprünglichen/);
  });
  it('rejects multiple final commits bearing the same order ID before and after integration', async () => {
    const f = fixture('APP-1');
    await expect(
      verifyOrderGit(options(f), { readPlatform: platform(f) }),
    ).rejects.toThrow('genau einen');
    const mergeSha = merge(f);
    await expect(
      verifyOrderGit(options(f, { branch: 'develop', prNumber: 7 }), {
        readPlatform: platform(f, { merged: true, mergeSha }),
      }),
    ).rejects.toThrow('genau den einen');
  });
  it('does not count commits belonging to another order and rejects wrong-order, missing and unpublished candidates', async () => {
    const f = fixture('APP-2');
    expect(
      (await verifyOrderGit(options(f), { readPlatform: platform(f) }))
        .commitSha,
    ).toBe(f.commit);
    await expect(
      verifyOrderGit(options(f, { orderId: 'APP-10' }), {
        readPlatform: platform(f),
      }),
    ).rejects.toThrow('Kennung');
    await expect(
      verifyOrderGit(options(f, { commitSha: 'e'.repeat(40) }), {
        readPlatform: platform(f),
      }),
    ).rejects.toThrow('nicht abgeschlossen');
    await expect(
      verifyOrderGit(options(f), {
        readPlatform: async () => ({ commit: { sha: f.base } }),
      }),
    ).rejects.toThrow('Remote-Branch');
  });
  it('refuses failed/cancelled/pending or incomplete CI and cross-repository PR associations', async () => {
    const f = fixture(),
      mergeSha = merge(f);
    for (const ci of ['failure', 'cancelled', 'action_required'])
      await expect(
        verifyOrderGit(options(f, { branch: 'develop', prNumber: 7 }), {
          readPlatform: platform(f, { merged: true, mergeSha, ci }),
        }),
      ).rejects.toThrow('CI');
    await expect(
      verifyOrderGit(options(f, { branch: 'develop', prNumber: 7 }), {
        readPlatform: platform(f, { merged: true, mergeSha, total: 101 }),
      }),
    ).rejects.toThrow('Prüfgrenze');
    await expect(
      verifyOrderGit(options(f, { branch: 'develop', prNumber: 7 }), {
        readPlatform: platform(f, {
          merged: true,
          mergeSha,
          repository: 'someone/fork',
        }),
      }),
    ).rejects.toThrow('Repository');
  });
  it('records unmerged PR state and chooses the latest run for each check identity', async () => {
    const f = fixture();
    const result = await verifyOrderGit(options(f, { prNumber: 7 }), {
      readPlatform: platform(f, {
        checks: [
          {
            id: 1,
            html_url: 'https://github.com/owner/repo/actions/runs/1',
            name: 'verify',
            head_sha: f.commit,
            status: 'completed',
            conclusion: 'failure',
            app: { id: 1 },
          },
          {
            id: 2,
            html_url: 'https://github.com/owner/repo/actions/runs/2',
            name: 'verify',
            head_sha: f.commit,
            status: 'in_progress',
            conclusion: null,
            app: { id: 1 },
          },
        ],
      }),
    });
    expect(result.pr!.merged).toBe(false);
    expect(
      result.ci.find((c: { name: string }) => c.name === 'verify').conclusion,
    ).toBe('pending');
  });
  it('rejects unsafe identifiers and credentialed links without shell or remote helper execution', async () => {
    const f = fixture();
    for (const extra of [
      { branch: '-c core.sshCommand=bad' },
      { branch: 'codex/test; touch marker' },
      { repository: 'https://user:password@github.com/owner/repo' },
      { commitSha: 'HEAD' },
      { orderId: 'APP-1;bad' },
    ])
      await expect(
        verifyOrderGit(options(f, extra), { readPlatform: platform(f) }),
      ).rejects.toThrow();
    const reader = platform(f);
    await expect(
      verifyOrderGit(options(f, { prNumber: 7 }), {
        readPlatform: async (endpoint: string) =>
          endpoint.endsWith('/pulls/7')
            ? {
                ...(await reader(endpoint)),
                html_url:
                  'https://secret:password@github.com/owner/repo/pull/7',
              }
            : reader(endpoint),
      }),
    ).rejects.toThrow('Unsicherer');
  });
});
