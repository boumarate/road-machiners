import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { must, realRun } from './exec';
import { hostRepo } from './repo';
import type { FactoryConfig, Run } from './types';

function fakeRun(fail: (args: string[]) => boolean = () => false): { run: Run; calls: string[][] } {
  const calls: string[][] = [];
  const run: Run = async (_cmd, args) => { calls.push(args); return { code: fail(args) ? 1 : 0, stdout: 'a.ts\n', stderr: '' }; };
  return { run, calls };
}

const cfg = (home: string): FactoryConfig => ({ home, repo: 'o/r' }) as FactoryConfig;

function tmpHome(): string {
  mkdirSync('tmp', { recursive: true });
  return resolve(mkdtempSync(join('tmp', 'factory-repo-')));
}

describe('hostRepo', () => {
  it('turns hooks off on every git call', async () => {
    const { run, calls } = fakeRun();
    const repo = hostRepo(run, cfg('/nowhere/home'));
    await repo.push('b');
    await repo.headHash('b');
    await repo.diff('dev', 'b');
    await repo.hasNewCommits('dev', 'b');
    await repo.fetchFromWork('/w', 'b');
    await repo.mergeLog('dev', 'main');
    await repo.merge('b', 'dev', 'msg');
    await repo.createBranch('r', 'dev');
    await repo.revertIssueMerge(3, 'r');
    await repo.deleteBranch('b');
    expect(calls.length).toBeGreaterThan(12);
    for (const args of calls) expect(args.slice(0, 2)).toEqual(['-c', 'core.hooksPath=/dev/null']);
  });

  it('aborts and names the files when a merge conflicts', async () => {
    const { run, calls } = fakeRun((args) => args.includes('--no-ff'));
    await expect(hostRepo(run, cfg('/h')).merge('b', 'dev', 'msg')).rejects.toThrow('Conflicting files: a.ts');
    expect(calls.some((a) => a.includes('--abort'))).toBe(true);
  });

  it('fetches a work branch into the host clone', async () => {
    const { run, calls } = fakeRun();
    await hostRepo(run, cfg('/h')).fetchFromWork('/w/x', 'factory/issue-3');
    expect(calls[0].slice(6)).toEqual(['fetch', '/w/x', '+factory/issue-3:factory/issue-3']);
  });

  it('merges and aborts a real conflict, leaving the tree clean', async () => {
    const home = tmpHome();
    const repo = hostRepo(realRun, cfg(home));
    const git = (...a: string[]) => realRun('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo.path });
    mkdirSync(repo.path);
    await git('init', '-b', 'dev');
    await git('config', 'user.name', 't');
    await git('config', 'user.email', 't@t');
    writeFileSync(join(repo.path, 'f.txt'), 'base\n');
    await git('add', '.');
    await git('commit', '-m', 'base');
    await git('checkout', '-b', 'feat');
    writeFileSync(join(repo.path, 'f.txt'), 'feat\n');
    await git('commit', '-am', 'feat');
    await git('checkout', 'dev');
    writeFileSync(join(repo.path, 'f.txt'), 'dev\n');
    await git('commit', '-am', 'dev');
    await expect(repo.merge('feat', 'dev', 'm')).rejects.toThrow('f.txt');
    expect((await git('status', '--porcelain')).stdout).toBe('');
  });
});

// A host clone of a bare origin. Branch main holds one file, dev starts from it, and each feature is a --no-ff merge like approval makes.
async function releaseSetup() {
  const home = tmpHome();
  const origin = join(home, 'origin.git');
  const repo = hostRepo(realRun, cfg(home));
  const git = async (...a: string[]) => must(await realRun('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo.path }), `git ${a.join(' ')}`);
  mkdirSync(origin);
  await realRun('git', ['init', '--bare', '-b', 'main'], { cwd: origin });
  await realRun('git', ['clone', origin, repo.path], { cwd: home });
  await git('checkout', '-b', 'main');
  writeFileSync(join(repo.path, 'f.txt'), 'base\n');
  writeFileSync(join(repo.path, 'g.txt'), 'g\n');
  await git('add', '.');
  await git('commit', '-m', 'base');
  await git('push', 'origin', 'main');
  await git('checkout', '-b', 'dev');
  await git('push', 'origin', 'dev');
  const feature = async (issue: number, file: string, text: string, into: string) => {
    await git('checkout', '-B', `factory/issue-${issue}`, 'dev');
    writeFileSync(join(repo.path, file), text);
    await git('commit', '-am', `work on ${issue}`);
    await git('checkout', into);
    await repo.merge(`factory/issue-${issue}`, into, `Merge issue #${issue}: title ${issue}`);
  };
  return { repo, git, feature, origin, home };
}

describe('release branch operations', () => {
  it('reverts the merge of one issue on the branch that has it and leaves the other branch alone', async () => {
    const { repo, git, feature } = await releaseSetup();
    await feature(3, 'f.txt', 'three\n', 'dev');
    await feature(4, 'g.txt', 'four\n', 'dev');
    await repo.createBranch('release/x', 'dev');
    expect(await repo.revertIssueMerge(3, 'release/x')).toBe(true);
    expect(readFileSync(join(repo.path, 'f.txt'), 'utf8')).toBe('base\n');
    expect(readFileSync(join(repo.path, 'g.txt'), 'utf8')).toBe('four\n');
    await git('checkout', 'dev');
    expect(readFileSync(join(repo.path, 'f.txt'), 'utf8')).toBe('three\n');
  });

  it('matches the issue number exactly and answers false for a merge the branch lacks', async () => {
    const { repo, feature } = await releaseSetup();
    await feature(12, 'f.txt', 'twelve\n', 'dev');
    expect(await repo.revertIssueMerge(1, 'dev')).toBe(false);
    expect(await repo.revertIssueMerge(99, 'dev')).toBe(false);
    expect(readFileSync(join(repo.path, 'f.txt'), 'utf8')).toBe('twelve\n');
  });

  it('aborts and throws on a conflicting revert, leaving the tree clean', async () => {
    const { repo, git, feature } = await releaseSetup();
    await feature(3, 'f.txt', 'three\n', 'dev');
    await git('checkout', '-B', 'factory/issue-4', 'dev');
    writeFileSync(join(repo.path, 'f.txt'), 'four\n');
    await git('commit', '-am', 'work on 4');
    await git('checkout', 'dev');
    await repo.merge('factory/issue-4', 'dev', 'Merge issue #4: title 4');
    await expect(repo.revertIssueMerge(3, 'dev')).rejects.toThrow('f.txt');
    expect((await git('status', '--porcelain')).trim()).toBe('');
  });

  it('deletes a branch locally and on origin, and does nothing when it is gone', async () => {
    const { repo, git, origin } = await releaseSetup();
    await git('branch', 'factory/issue-7', 'dev');
    await git('push', 'origin', 'factory/issue-7');
    await repo.deleteBranch('factory/issue-7');
    expect((await git('branch', '--list', 'factory/issue-7')).trim()).toBe('');
    expect((await realRun('git', ['ls-remote', '--heads', origin, 'factory/issue-7'])).stdout.trim()).toBe('');
    await expect(repo.deleteBranch('factory/issue-7')).resolves.toBeUndefined();
  });

  it('deletes a branch that only exists locally', async () => {
    const { repo, git } = await releaseSetup();
    await git('branch', 'factory/issue-8', 'dev');
    await repo.deleteBranch('factory/issue-8');
    expect((await git('branch', '--list', 'factory/issue-8')).trim()).toBe('');
  });

  it('syncs the extra branch as well as dev and main', async () => {
    const { repo, git, feature, home } = await releaseSetup();
    await feature(3, 'f.txt', 'three\n', 'dev');
    await git('push', 'origin', 'dev');
    await repo.createBranch('release/x', 'dev');
    await repo.push('release/x');
    const other = join(home, 'other');
    await realRun('git', ['clone', join(home, 'origin.git'), other], { cwd: home });
    await realRun('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'checkout', 'release/x'], { cwd: other });
    writeFileSync(join(other, 'g.txt'), 'later\n');
    await realRun('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-am', 'later'], { cwd: other });
    await realRun('git', ['push', 'origin', 'release/x'], { cwd: other });
    await repo.sync('release/x');
    expect((await git('show', 'release/x:g.txt'))).toBe('later\n');
    await repo.sync('release/x');
  });
});
