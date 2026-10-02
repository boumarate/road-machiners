import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pauseFile, updateFailedFile } from './pause';
import { pausedTick } from './paused-tick';
import { EMPTY_STATE, readState, writeState } from './state';
import { FACTORY_MARK, NEEDS_INFO_LABEL, QUESTIONS_HEADING, STUCK_LABEL, type Card, type Ctx, type IssueComment } from './types';

const asked: IssueComment = { login: 'bot', body: `${QUESTIONS_HEADING}\n\n1. What?\n\n${FACTORY_MARK}` };
const image: IssueComment = { login: 'anna', body: '<img width="1" src="https://github.com/user-attachments/assets/882dcec0-4280-4896-9c35-eb126be63a02" />' };
const card = (issue: number, labels: string[] = [NEEDS_INFO_LABEL]): Card => ({ itemId: `i${issue}`, issue, column: 'Triage', labels });

function setup(pause: string | null, comments: IssueComment[], liveJobs = 2, cards: Card[] = [card(81)]) {
  const home = mkdtempSync(join(tmpdir(), 'paused-'));
  const statePath = join(home, 'state.json');
  const jobs = Array.from({ length: liveJobs }, (_, i) => ({ id: `j${i}`, stage: 'testing' as const, issue: 100 + i, pid: 1, startedAt: '', log: '' }));
  const initial = { ...structuredClone(EMPTY_STATE), jobs };
  writeState(statePath, initial);
  if (pause !== null) writeFileSync(pauseFile(home), pause);
  const removed: string[] = [];
  const other: string[] = [];
  const github = {
    cards: async () => cards,
    comments: async (_n: number) => comments,
    removeLabel: async (n: number, l: string) => { removed.push(`${n}:${l}`); },
    addLabel: async () => { other.push('addLabel'); },
  };
  const repo = { fetch: async () => { other.push('fetch'); } };
  const ctx = { cfg: { home }, github, repo, statePath, log: () => undefined } as unknown as Ctx;
  return { ctx, home, github, removed, other, initial };
}

describe('pausedTick', () => {
  it('releases an issue answered with an HTML image while an update drains jobs, and spawns and writes nothing', async () => {
    const t = setup('update to 1086eba, waiting for the running jobs', [asked, image]);
    await pausedTick(t.ctx);
    expect(t.removed).toEqual([`81:${NEEDS_INFO_LABEL}`]);
    expect(t.other).toEqual([]);
    expect(readState(t.ctx.statePath)).toEqual(t.initial);
  });

  it('leaves an unanswered issue and a stuck label alone', async () => {
    const t = setup('update to 1086eba, waiting for the running jobs', [asked], 1, [card(81), card(82, [STUCK_LABEL])]);
    await pausedTick(t.ctx);
    expect(t.removed).toEqual([]);
  });

  it('does nothing under a manual pause', async () => {
    for (const reason of ['Hermes repairs #4', '', 'please update to 1086eba']) {
      const t = setup(reason, [asked, image]);
      await pausedTick(t.ctx);
      expect(t.removed).toEqual([]);
    }
  });

  it('does nothing when the update has failed or no job runs', async () => {
    const failed = setup('update to 1086eba, waiting for the running jobs', [asked, image]);
    writeFileSync(updateFailedFile(failed.home), 'npm ci failed');
    await pausedTick(failed.ctx);
    expect(failed.removed).toEqual([]);
    const idle = setup('update to 1086eba, waiting for the running jobs', [asked, image], 0);
    await pausedTick(idle.ctx);
    expect(idle.removed).toEqual([]);
  });

  it('does nothing without a pause', async () => {
    const t = setup(null, [asked, image]);
    await pausedTick(t.ctx);
    expect(t.removed).toEqual([]);
  });

  it('stops when the pause turns into a manual one mid-pass', async () => {
    const t = setup('update to 1086eba, waiting for the running jobs', [asked, image], 1, [card(81), card(82)]);
    t.github.comments = async () => { writeFileSync(pauseFile(t.home), 'Hermes repairs state'); return [asked, image]; };
    await pausedTick(t.ctx);
    expect(t.removed).toEqual([]);
  });
});
