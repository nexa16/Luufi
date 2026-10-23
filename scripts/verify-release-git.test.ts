import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyReleaseGit } from './verify-release-git.mjs';
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
function fixture(annotated = false, integrated = true) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'luufi-release-proof-'));
  directories.push(cwd);
  git(cwd, 'init', '-b', 'main');
  writeFileSync(path.join(cwd, 'base.txt'), 'Synthetic base');
  git(cwd, 'add', 'base.txt');
  git(cwd, 'commit', '-m', 'chore: root');
  const root = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'checkout', '-b', 'develop');
  writeFileSync(path.join(cwd, 'feature.txt'), 'Synthetic feature');
  git(cwd, 'add', 'feature.txt');
  git(cwd, 'commit', '-m', 'feat(APP-1): implemented');
  const versionCommit = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'checkout', 'main');
  if (integrated)
    git(cwd, 'merge', '--no-ff', 'develop', '-m', 'Release promotion');
  const productionCommit = git(cwd, 'rev-parse', 'HEAD');
  if (annotated)
    git(cwd, 'tag', '-a', 'release/1', '-m', 'Approved synthetic tag');
  else git(cwd, 'tag', 'release/1');
  return { cwd, root, versionCommit, productionCommit };
}
type Facts = {
  branchHead?: string;
  tagCommit?: string;
  ciHead?: string;
  conclusion?: string;
  status?: string;
  total?: number;
  tagLoop?: boolean;
};
function platform(f: ReturnType<typeof fixture>, facts: Facts = {}) {
  return async (endpoint: string) => {
    if (endpoint.includes('/branches/'))
      return { commit: { sha: facts.branchHead ?? f.productionCommit } };
    if (endpoint.includes('/git/ref/tags/')) {
      const id = git(f.cwd, 'rev-parse', 'refs/tags/release/1');
      return {
        object: {
          type: facts.tagLoop ? 'tag' : git(f.cwd, 'cat-file', '-t', id),
          sha: facts.tagCommit ?? id,
        },
      };
    }
    if (endpoint.includes('/git/tags/'))
      return {
        object: {
          type: facts.tagLoop ? 'tag' : 'commit',
          sha: facts.tagCommit ?? f.productionCommit,
        },
      };
    if (endpoint.includes('/check-runs'))
      return {
        total_count: facts.total ?? 1,
        check_runs: [
          {
            id: 1,
            app: { id: 2 },
            name: 'verify',
            html_url: 'https://github.com/owner/repo/actions/runs/1/job/1',
            head_sha: facts.ciHead ?? f.productionCommit,
            status: facts.status ?? 'completed',
            conclusion: facts.conclusion ?? 'success',
          },
        ],
      };
    if (endpoint.includes('/actions/runs?'))
      return {
        total_count: 1,
        workflow_runs: [
          {
            id: 2,
            workflow_id: 3,
            name: 'CI',
            html_url: 'https://github.com/owner/repo/actions/runs/1',
            head_sha: facts.ciHead ?? f.productionCommit,
            status: facts.status ?? 'completed',
            conclusion: facts.conclusion ?? 'success',
          },
        ],
      };
    throw new Error('Unexpected fixture endpoint');
  };
}
const input = (
  f: ReturnType<typeof fixture>,
  override: Record<string, unknown> = {},
) => ({
  cwd: f.cwd,
  repository: 'owner/repo',
  productionBranch: 'main',
  productionCommit: f.productionCommit,
  tag: 'release/1',
  versionCommit: f.versionCommit,
  ...override,
});
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (
      !path
        .resolve(directory)
        .startsWith(path.resolve(os.tmpdir()) + path.sep) ||
      !path.basename(directory).startsWith('luufi-release-proof-')
    )
      throw new Error('Unsafe fixture path');
    rmSync(directory, { recursive: true, force: true });
  }
});
describe('LUUFI-16 actual readonly release Git facts', () => {
  it('ignores grafts introduced after preflight while the remote branch is read', async () => {
    const f = fixture(false, false),
      reader = platform(f);
    await expect(
      verifyReleaseGit(input(f), {
        readPlatform: async (endpoint: string) => {
          const result = await reader(endpoint);
          if (endpoint.includes('/branches/'))
            writeFileSync(
              path.join(f.cwd, '.git', 'info', 'grafts'),
              `${f.productionCommit} ${f.versionCommit}\n`,
            );
          return result;
        },
      }),
    ).rejects.toThrow('nicht im Produktionscommit');
  });
  it('rejects forged ancestry from local info/grafts rather than claiming version inclusion', async () => {
    const f = fixture(false, false);
    await expect(
      verifyReleaseGit(input(f), { readPlatform: platform(f) }),
    ).rejects.toThrow('nicht im Produktionscommit');
    writeFileSync(
      path.join(f.cwd, '.git', 'info', 'grafts'),
      `${f.productionCommit} ${f.versionCommit}\n`,
    );
    await expect(
      verifyReleaseGit(input(f), { readPlatform: platform(f) }),
    ).rejects.toThrow('Graft');
  });
  it('rejects inherited GIT_GRAFT_FILE instead of trusting its forged commit parents', async () => {
    const f = fixture(false, false),
      graft = path.join(f.cwd, 'external-grafts');
    writeFileSync(graft, `${f.productionCommit} ${f.versionCommit}\n`);
    const previous = process.env.GIT_GRAFT_FILE;
    process.env.GIT_GRAFT_FILE = graft;
    try {
      await expect(
        verifyReleaseGit(input(f), { readPlatform: platform(f) }),
      ).rejects.toThrow('GIT_GRAFT_FILE');
    } finally {
      if (previous === undefined) delete process.env.GIT_GRAFT_FILE;
      else process.env.GIT_GRAFT_FILE = previous;
    }
  });
  it.each([false, true])(
    'reads a genuine %s annotated tag and exact production ancestry without changing refs',
    async (annotated) => {
      const f = fixture(annotated),
        before = git(f.cwd, 'show-ref');
      const value = await verifyReleaseGit(input(f), {
        readPlatform: platform(f),
      });
      expect(value).toMatchObject({
        repository: 'owner/repo',
        productionBranch: 'main',
        productionHead: f.productionCommit,
        tag: 'release/1',
        tagCommit: f.productionCommit,
        versionCommit: f.versionCommit,
        versionCommitIncluded: true,
        source: 'codex-local-git',
      });
      expect(value.ci).toHaveLength(2);
      expect(git(f.cwd, 'show-ref')).toBe(before);
    },
  );
  it('rejects the unchanged root production branch when it does not include the version', async () => {
    const f = fixture(false, false);
    await expect(
      verifyReleaseGit(input(f), { readPlatform: platform(f) }),
    ).rejects.toThrow('nicht im Produktionscommit');
  });
  it('rejects stale local heads, wrong remote tags and bounded annotated-tag loops', async () => {
    const f = fixture();
    await expect(
      verifyReleaseGit(input(f), {
        readPlatform: platform(f, { branchHead: f.root }),
      }),
    ).rejects.toThrow('Remote-Produktionsbranch');
    await expect(
      verifyReleaseGit(input(f), {
        readPlatform: platform(f, { tagCommit: f.root }),
      }),
    ).rejects.toThrow('Remote-Tag');
    await expect(
      verifyReleaseGit(input(f), {
        readPlatform: platform(f, { tagLoop: true }),
      }),
    ).rejects.toThrow('Tagverschachtelung');
    git(f.cwd, 'tag', '-f', 'release/1', f.root);
    await expect(
      verifyReleaseGit(input(f), { readPlatform: platform(f) }),
    ).rejects.toThrow('lokale Tag');
  });
  it('requires successful current production-head CI and refuses incomplete platform collections', async () => {
    const f = fixture();
    for (const facts of [
      { ciHead: f.root },
      { conclusion: 'failure' },
      { conclusion: 'cancelled' },
      { status: 'in_progress' },
      { total: 101 },
      { total: 2 },
    ])
      await expect(
        verifyReleaseGit(input(f), { readPlatform: platform(f, facts) }),
      ).rejects.toThrow(/CI|Prüfgrenze/);
  });
  it('supports GitHub HTTPS identity and encodes branch/tag API paths', async () => {
    const f = fixture(true);
    const seen: string[] = [],
      reader = platform(f);
    const value = await verifyReleaseGit(
      input(f, { repository: 'https://github.com/Owner/Repo.git' }),
      {
        readPlatform: async (endpoint: string) => {
          seen.push(endpoint);
          return reader(endpoint);
        },
      },
    );
    expect(value.repository).toBe('https://github.com/Owner/Repo.git');
    expect(
      seen.some(
        (endpoint) => endpoint === 'repos/owner/repo/git/ref/tags/release%2F1',
      ),
    ).toBe(true);
    await expect(
      verifyReleaseGit(
        input(f, { repository: 'https://gitlab.com/owner/repo' }),
        { readPlatform: reader },
      ),
    ).rejects.toThrow('GitHub');
  });
  it('denies unsafe refs, credentials, extra parameters and wrong build targets without publishing anything', async () => {
    const f = fixture();
    for (const extra of [
      { productionBranch: '-c malicious' },
      { tag: 'tag; shell command' },
      { repository: 'https://user:password@github.com/owner/repo' },
      { productionCommit: 'HEAD' },
      { deploy: true },
      { versionCommit: 'e'.repeat(40) },
    ])
      await expect(
        verifyReleaseGit(input(f, extra), { readPlatform: platform(f) }),
      ).rejects.toThrow();
  });
});
