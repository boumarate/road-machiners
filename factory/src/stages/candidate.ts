import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAndDeploy, recordBuild } from '../deploy';
import { updateState } from '../state';
import { GAME_DIR, OUT_DIR, type Ctx } from '../types';
import { agentHome, fillPrompt, readOutput, resetOutputs } from './common';
import { candidateDir, featureLine, releaseFeatures, releaseLog, requireRelease, trackingLink, type Feature } from './release-common';
import { CAPTION_LIMIT, cut } from './testing';

// The build of the candidate lives under this web folder, kept while the tracking card waits in Approval.
export const CANDIDATE_SCOPE = 'rc';

const SERVER_TRIES = 60;

// Starts the dev server with a bounded wait, plays the game on the CPU, keeps the newest screenshot, then stops the server.
const PLAYTEST_SCRIPT = `set -u
mkdir -p ${OUT_DIR}
npm ci
npm run dev > ${OUT_DIR}/dev-server.log 2>&1 &
server=$!
ready=0
for i in $(seq 1 ${SERVER_TRIES}); do
  if curl -sf http://localhost:5173 > /dev/null; then ready=1; break; fi
  sleep 1
done
status=1
if [ "$ready" = 1 ]; then
  status=0
  npm run playtest -- --cpu || status=$?
else
  echo "dev server did not start in ${SERVER_TRIES} seconds"
fi
kill "$server" || true
[ "$status" = 0 ] || exit "$status"
shot=$(ls -t .playtest/*.png | head -n 1)
cp "$shot" ${OUT_DIR}/screenshot.png
`;

// Posts the release branch as a playable candidate. Ship acts on this post alone.
export async function candidate(ctx: Ctx, issue: number): Promise<void> {
  const release = requireRelease(ctx);
  if (release.issue !== issue) throw new Error(`Issue #${issue} is not the tracking issue of the open release, #${release.issue} is`);
  await ctx.repo.sync(release.branch);
  const features = await releaseFeatures(ctx, release);
  const dir = candidateDir(ctx);
  rmSync(dir, { recursive: true, force: true });
  await ctx.repo.prepareWorkClone(release.branch, release.branch, dir);
  const home = agentHome(dir, GAME_DIR);
  resetOutputs(home);
  writeFileSync(join(home, OUT_DIR, 'changelog.md'), `${features.map(featureLine).join('\n')}\n`);
  const log = releaseLog(ctx, 'candidate');
  await ctx.container.shell(dir, PLAYTEST_SCRIPT, log);
  await ctx.container.agent({ clone: dir, dir: GAME_DIR, model: ctx.cfg.buildModel, prompt: fillPrompt('release', {}), log });
  const notes = readOutput(home, 'release.md');
  if (notes === null) throw new Error('release agent wrote no .factory/release.md');
  const url = await buildAndDeploy(ctx, dir, CANDIDATE_SCOPE, log);
  recordBuild(ctx.statePath, issue, CANDIDATE_SCOPE);
  const pr = (await ctx.github.pullRequestFor(release.branch)) ?? await ctx.github.openPullRequest(release.branch, 'main', `Release ${release.day}`, `The release candidate of ${release.day}. The factory merges it when the committee presses Ship.`);
  const link = trackingLink(ctx, issue);
  const list = features.map(featureLine).join('\n');
  await ctx.github.comment(issue, `Release candidate: ${url}\n\n${notes.trim()}\n\nFeatures:\n${list || 'None.'}`);
  const caption = candidateCaption(release.day, url, link, pr, notes.trim(), features);
  const buttons = [[{ text: 'Ship', data: `factory:ship:${issue}` }]];
  const photoId = await ctx.telegram.sendPhoto(ctx.cfg.committeeChat, join(home, OUT_DIR, 'screenshot.png'), caption, buttons);
  updateState(ctx.statePath, (state) => ({ ...state, release: state.release && { ...state.release, postId: photoId } }));
}

const SEPARATOR = '\n\n';

// Fits Telegram's caption limit. The notes take at most half of the room left after the fixed lines, and the
// feature list cuts to "and K more" when it does not fit. The full list is on the tracking issue.
export function candidateCaption(day: string, url: string, link: string, pr: string, notes: string, features: Feature[]): string {
  const head = `ROAM release candidate ${day}\n\nPlay: ${url}\nPR: ${pr}\nIssue: ${link}`;
  const tail = 'Ship publishes it. Reply "remove #N" to take a feature out. Any other reply asks for a change and holds the release.';
  const room = CAPTION_LIMIT - head.length - tail.length - 3 * SEPARATOR.length;
  const shownNotes = cut(notes, Math.floor(room / 2));
  return [head, shownNotes, fitFeatures(features, room - shownNotes.length), tail].join(SEPARATOR);
}

function fitFeatures(features: Feature[], room: number): string {
  if (features.length === 0) return 'No features in this candidate.';
  for (let shown = features.length; shown >= 0; shown--) {
    const lines = features.slice(0, shown).map(featureLine);
    if (shown < features.length) lines.push(`and ${features.length - shown} more, see the issue`);
    const text = lines.join('\n');
    if (text.length <= room) return text;
  }
  throw new Error('The candidate caption has no room for its feature list');
}
