import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readState } from '../state';
import type { Ctx, ReleaseState } from '../types';

export type Feature = { issue: number; title: string };

const FEATURE_MERGE = /^Merge issue #(\d+): (.*)$/;

// Only feature merges count. Other merges on dev, like main coming back after a ship, are not features.
export function featureMerges(subjects: string[]): Feature[] {
  return subjects.flatMap((subject) => {
    const match = FEATURE_MERGE.exec(subject);
    return match ? [{ issue: Number(match[1]), title: match[2] }] : [];
  });
}

export function featureLine(feature: Feature): string {
  return `#${feature.issue} ${feature.title}`;
}

export function requireRelease(ctx: Ctx): ReleaseState {
  const release = readState(ctx.statePath).release;
  if (release === null) throw new Error('No release is open');
  return release;
}

// The features the release would ship: merges on its branch that main lacks, minus the removed ones.
export async function releaseFeatures(ctx: Ctx, release: ReleaseState): Promise<Feature[]> {
  const merges = featureMerges(await ctx.repo.mergeLog(release.branch, 'main'));
  return merges.filter((feature) => !release.removed.includes(feature.issue));
}

// The candidate's clone keeps its screenshot and notes for Ship, so Ship posts what the committee played.
export function candidateDir(ctx: Ctx): string {
  return join(ctx.cfg.home, 'work', 'release-candidate');
}

export function releaseLog(ctx: Ctx, name: string): string {
  const dir = join(ctx.cfg.home, 'logs');
  mkdirSync(dir, { recursive: true });
  return join(dir, `${name}.log`);
}

export function trackingLink(ctx: Ctx, issue: number): string {
  return `https://github.com/${ctx.cfg.repo}/issues/${issue}`;
}
