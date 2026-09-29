import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { must } from './exec';
import type { FactoryConfig, HostRepo, Run } from './types';

// Hooks are switched off on every call, so no git command here runs code from a repository.
const NO_HOOKS = ['-c', 'core.hooksPath=/dev/null'];
const SYNCED_BRANCHES = ['dev', 'main'];

export function hostRepo(run: Run, cfg: FactoryConfig): HostRepo {
  const path = `${cfg.home}/repo`;
  const gitIn = async (cwd: string, args: string[]): Promise<string> => must(await run('git', [...NO_HOOKS, ...args], { cwd }), `git ${args.join(' ')}`);
  const git = (args: string[]): Promise<string> => gitIn(path, args);
  const hasRef = async (ref: string): Promise<boolean> => (await run('git', [...NO_HOOKS, 'rev-parse', '--verify', '--quiet', ref], { cwd: path })).code === 0;

  async function fastForward(branch: string): Promise<void> {
    if (await hasRef(`refs/heads/${branch}`)) {
      await git(['checkout', branch]);
      await git(['merge', '--ff-only', `origin/${branch}`]);
    } else {
      await git(['checkout', '-b', branch, `origin/${branch}`]);
    }
  }

  // The work clone sees the host's local branches as origin/*.
  async function checkoutBranch(dir: string, branch: string, base: string): Promise<void> {
    if (await hasRef(`refs/heads/${branch}`)) {
      await gitIn(dir, ['checkout', '-B', branch, `origin/${branch}`]);
    } else if (await hasRef(`refs/remotes/origin/${branch}`)) {
      await gitIn(dir, ['fetch', path, `refs/remotes/origin/${branch}:refs/heads/${branch}`]);
      await gitIn(dir, ['checkout', branch]);
    } else {
      await gitIn(dir, ['checkout', '-b', branch, `origin/${base}`]);
    }
  }

  async function conflictedFiles(): Promise<string[]> {
    return (await git(['diff', '--name-only', '--diff-filter=U'])).split('\n').filter(Boolean);
  }

  return {
    path,
    async sync() {
      if (!existsSync(path)) {
        mkdirSync(dirname(path), { recursive: true });
        await gitIn(dirname(path), ['clone', `https://github.com/${cfg.repo}.git`, path]);
      }
      await git(['fetch', 'origin']);
      for (const branch of SYNCED_BRANCHES) await fastForward(branch);
    },
    async prepareWorkClone(branch, base, dir) {
      if (existsSync(dir)) return;
      mkdirSync(dirname(dir), { recursive: true });
      await gitIn(dirname(dir), ['clone', '--no-hardlinks', path, dir]);
      await checkoutBranch(dir, branch, base);
    },
    async fetchFromWork(dir, branch) {
      await git(['fetch', dir, `+${branch}:${branch}`]);
    },
    async push(branch) {
      await git(['push', 'origin', branch]);
    },
    async headHash(branch) {
      return (await git(['rev-parse', '--short', branch])).trim();
    },
    diff: (base, branch) => git(['diff', `${base}...${branch}`]),
    async hasNewCommits(base, branch) {
      return Number((await git(['rev-list', '--count', `${base}..${branch}`])).trim()) > 0;
    },
    async merge(branch, into, message) {
      await git(['checkout', into]);
      const result = await run('git', [...NO_HOOKS, 'merge', '--no-ff', '-m', message, branch], { cwd: path });
      if (result.code === 0) return;
      const files = await conflictedFiles();
      const reason = (result.stderr || result.stdout).trim();
      if (files.length === 0) throw new Error(`merge of ${branch} into ${into} failed without a conflict: ${reason}`);
      await git(['merge', '--abort']);
      throw new Error(`merge of ${branch} into ${into} failed. Conflicting files: ${files.join(', ')}. ${reason}`);
    },
    async mergeLog(from, to) {
      return (await git(['log', '--first-parent', '--merges', '--format=%s', `${to}..${from}`])).split('\n').filter(Boolean);
    },
  };
}
