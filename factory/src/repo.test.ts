import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { realRun } from './exec';
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
    expect(calls.length).toBeGreaterThan(7);
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
    expect(calls[0].slice(2)).toEqual(['fetch', '/w/x', '+factory/issue-3:factory/issue-3']);
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
