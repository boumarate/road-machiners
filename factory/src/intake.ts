import { CANDIDATE_LABELS } from './types';
import type { Ctx, Issue } from './types';

type MarkRules = { minVotes: number; minAgeHours: number; committee: string[] };

const HOUR_MS = 3_600_000;

// An issue is marked when it is old enough and has enough thumbs-up or one from the committee.
export function isMarked(issue: Issue, now: Date, rules: MarkRules): boolean {
  const ageHours = (now.getTime() - new Date(issue.createdAt).getTime()) / HOUR_MS;
  if (ageHours < rules.minAgeHours) return false;
  const byCommittee = issue.thumbsUp.some((login) => rules.committee.includes(login));
  return byCommittee || issue.thumbsUp.length >= rules.minVotes;
}

// Puts every marked issue that is not yet on the board into Design.
export async function intake(ctx: Ctx): Promise<number[]> {
  const { cfg, github } = ctx;
  const rules = { minVotes: cfg.minVotes, minAgeHours: cfg.minAgeHours, committee: cfg.committeeGithub };
  const onBoard = new Set((await github.cards()).map((card) => card.issue));
  const candidates = await github.candidates(CANDIDATE_LABELS);
  const added: number[] = [];
  for (const issue of candidates) {
    if (onBoard.has(issue.number) || !isMarked(issue, ctx.now(), rules)) continue;
    await github.addCard(issue.number, 'Design');
    await github.comment(issue.number, 'The factory picked this up for design.');
    ctx.log('intake', issue.number, 'added to Design');
    added.push(issue.number);
  }
  return added;
}
