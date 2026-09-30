import { EMPTY_STATE, writeState } from '../state';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { agentHome } from './common';
import type { AgentRun, Card, Ctx, FactoryConfig, InlineButton } from '../types';

// Each test file loads its own copy of this module, so each file gets its own folder and parallel files never collide.
export const ROOT = resolve(`tmp/factory-periodic-test/${randomUUID()}`);
export const cfg = { home: ROOT, buildModel: 'sonnet', publicChannel: 'public', committeeChat: 'committee', repo: 'o/r' } as FactoryConfig;

export type Photo = { chat: string; path: string; caption: string; buttons?: InlineButton[][] };
export type Fake = { ctx: Ctx; calls: string[]; agentWrites: Record<string, string>; changelog: string[]; diff: string; cards: Card[]; photos: Photo[]; created: { title: string; body: string; labels: string[] }[] };

export function fake(): Fake {
  const f: Fake = { ctx: null as unknown as Ctx, calls: [], agentWrites: {}, changelog: [], diff: '', cards: [], photos: [], created: [] };
  const note = (text: string) => { f.calls.push(text); };
  f.ctx = {
    cfg,
    statePath: join(ROOT, 'state.json'),
    now: () => new Date('2026-09-29T10:00:00Z'),
    log: () => undefined,
    run: async (cmd: string, args: string[]) => { note(`run ${cmd} ${args.join(' ')}`); return { code: 0, stdout: '', stderr: '' }; },
    github: {
      createIssue: async (title: string, body: string, labels: string[]) => { note(`createIssue ${title}`); f.created.push({ title, body, labels }); return 10 + f.created.length; },
      cards: async () => f.cards,
      pullRequestFor: async () => null,
      reopen: async (n: number) => note(`reopen ${n}`),
      issue: async () => ({ number: 7, title: 'T', body: 'Simulate battles', labels: ['adhoc'], createdAt: '', state: 'OPEN', thumbsUp: [] }),
      editIssue: async () => note('editIssue'),
      comment: async (_n: number, body: string) => note(`comment ${body}`),
      move: async (_n: number, column: string) => note(`move ${column}`),
      close: async (_n: number, reason: string) => note(`close ${reason}`),
      removeLabel: async (n: number, label: string) => note(`removeLabel ${n} ${label}`),
      addCard: async (_n: number, column: string) => note(`addCard ${column}`),
      openPullRequest: async (branch: string, base: string, title: string) => { note(`pr ${branch} ${base} ${title}`); return 'http://pr'; },
    },
    telegram: {
      sendMessage: async (chat: string, text: string, replyTo?: number) => { note(`message ${chat} ${replyTo ?? '-'} ${text}`); return 1; },
      sendPhoto: async (chat: string, path: string, caption: string, buttons?: InlineButton[][]) => { note(`photo ${chat}`); f.photos.push({ chat, path, caption, buttons }); return 42; },
    },
    container: {
      shell: async () => note('shell'),
      agent: async (run: AgentRun) => {
        note('agent');
        const home = agentHome(run.clone, run.dir);
        mkdirSync(join(home, '.factory'), { recursive: true });
        for (const [name, text] of Object.entries(f.agentWrites)) writeFileSync(join(home, '.factory', name), text);
      },
    },
    repo: {
      path: join(ROOT, 'repo'),
      sync: async (...extra: string[]) => note(['sync', ...extra].join(' ')),
      prepareWorkClone: async (branch: string, _base: string, dir: string) => { note(`prepare ${branch}`); mkdirSync(dir, { recursive: true }); },
      fetchFromWork: async () => note('fetch'),
      push: async (branch: string) => note(`push ${branch}`),
      merge: async (branch: string, into: string) => note(`merge ${branch} ${into}`),
      mergeLog: async () => f.changelog,
      diff: async () => f.diff,
      hasNewCommits: async () => true,
      headHash: async () => 'abc1234',
      createBranch: async (name: string, from: string) => note(`branch ${name} ${from}`),
      revertIssueMerge: async (issue: number, branch: string) => { note(`revert ${issue} ${branch}`); return true; },
      deleteBranch: async (branch: string) => note(`delete ${branch}`),
    },
  } as unknown as Ctx;
  return f;
}

export function reset(): void {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(join(ROOT, 'repo', 'game'), { recursive: true });
  writeFileSync(join(ROOT, 'code.env'), '');
  writeState(join(ROOT, 'state.json'), structuredClone(EMPTY_STATE));
}

