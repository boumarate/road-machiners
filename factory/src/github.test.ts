import { describe, expect, it } from 'vitest';
import { ghClient } from './github';
import type { FactoryConfig, Run, RunResult } from './types';

const CFG = { repo: 'o/r', projectOwner: 'o', projectNumber: 3 } as FactoryConfig;
const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: '' });

const RAW = (number: number) => ({ number, title: `t${number}`, body: '', labels: [{ name: 'bug' }], createdAt: '2026-01-01T00:00:00Z', state: 'OPEN' });

function project(options: string[]): string {
  const field = { id: 'F1', options: options.map((name) => ({ id: `id-${name}`, name })) };
  return JSON.stringify({ data: { user: { projectV2: { id: 'P1', field } } } });
}

const ALL = ['Design', 'Implementation', 'Testing', 'Approval', 'Done'];

function fake(calls: string[][], projectJson: string): Run {
  return async (_cmd, args) => {
    calls.push(args);
    const text = args.join(' ');
    if (text.startsWith('issue list')) return ok(JSON.stringify(text.includes('--label bug') ? [RAW(1), RAW(2)] : [RAW(2), RAW(3)]));
    if (text.includes('/reactions')) return ok('anna\nboss\n');
    if (text.includes('repos/o/r/issues/1/comments')) return ok('{"login":"a","body":"hi\\nthere"}\n');
    if (text.includes('projectV2(number')) return ok(projectJson);
    if (text.includes('items(first')) {
      const items = { pageInfo: { hasNextPage: false, endCursor: '' }, nodes: [
        { id: 'I7', fieldValueByName: { name: 'Design' }, content: { number: 7, repository: { nameWithOwner: 'o/r' }, labels: { nodes: [{ name: 'bug' }] } } },
        { id: 'I8', fieldValueByName: { name: 'Done' }, content: { number: 8, repository: { nameWithOwner: 'x/y' }, labels: { nodes: [] } } },
        { id: 'I9', fieldValueByName: null, content: { number: 9, repository: { nameWithOwner: 'o/r' }, labels: { nodes: [] } } },
      ] };
      return ok(JSON.stringify({ data: { node: { items } } }));
    }
    return ok('');
  };
}

describe('ghClient', () => {
  it('unions candidates by number and fills thumbs-up', async () => {
    const found = await ghClient(fake([], project(ALL)), CFG).candidates(['bug', 'feature-request']);
    expect(found.map((i) => i.number)).toEqual([1, 2, 3]);
    expect(found[0].labels).toEqual(['bug']);
    expect(found[0].thumbsUp).toEqual(['anna', 'boss']);
  });

  it('reads comments', async () => {
    const list = await ghClient(fake([], project(ALL)), CFG).comments(1);
    expect(list).toEqual([{ login: 'a', body: 'hi\nthere' }]);
  });

  it('lists cards of this repo with a status', async () => {
    const cards = await ghClient(fake([], project(ALL)), CFG).cards();
    expect(cards).toEqual([{ itemId: 'I7', issue: 7, column: 'Design', labels: ['bug'] }]);
  });

  it('move sets the status option of the item', async () => {
    const calls: string[][] = [];
    await ghClient(fake(calls, project(ALL)), CFG).move(7, 'Testing');
    const mutation = calls.find((args) => args.join(' ').includes('updateProjectV2ItemFieldValue')) ?? [];
    expect(mutation).toEqual(expect.arrayContaining(['project=P1', 'item=I7', 'field=F1', 'option=id-Testing']));
  });

  it('finds the open pull request of a branch or null', async () => {
    const run: Run = async (_cmd, args) => ok(args.includes('factory/issue-7') ? '[{"url":"https://github.com/o/r/pull/3"}]' : '[]');
    const client = ghClient(run, CFG);
    expect(await client.pullRequestFor('factory/issue-7')).toBe('https://github.com/o/r/pull/3');
    expect(await client.pullRequestFor('factory/issue-8')).toBeNull();
  });

  it('lists pull requests by head and closes one with a comment', async () => {
    const calls: string[][] = [];
    const client = ghClient(async (_cmd, args) => { calls.push(args); return ok('[]'); }, CFG);
    await client.pullRequestFor('b');
    await client.closePullRequest('b', 'Denied');
    expect(calls[0]).toEqual(['pr', 'list', '-R', 'o/r', '--head', 'b', '--state', 'open', '--json', 'url']);
    expect(calls[1]).toEqual(['pr', 'close', 'b', '-R', 'o/r', '--comment', 'Denied']);
  });

  it('names a missing Status option', async () => {
    const client = ghClient(fake([], project(['Design', 'Done'])), CFG);
    await expect(client.cards()).rejects.toThrow('"Implementation"');
  });
});
