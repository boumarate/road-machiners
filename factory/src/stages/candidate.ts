import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAndDeploy, recordBuild } from '../deploy';
import { updateState } from '../state';
import { GAME_DIR, OUT_DIR, type Ctx } from '../types';
import { agentHome, fillPrompt, readOutput, resetOutputs } from './common';
import { candidateDir, changeLines, featureLine, openReleaseTasks, releaseFeatures, releaseLog, requireRelease, trackingLink } from './release-common';

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
  const changes = changeLines(notes, features).join('\n') || 'No changes in this candidate.';
  const url = await buildAndDeploy(ctx, dir, CANDIDATE_SCOPE, log);
  recordBuild(ctx.statePath, issue, CANDIDATE_SCOPE);
  const pr = (await ctx.github.pullRequestFor(release.branch)) ?? await ctx.github.openPullRequest(release.branch, 'main', `Release ${release.day}`, `The release candidate of ${release.day}. The factory merges it when the committee presses Ship.`);
  // A reply to the old post can open a release task while this build runs. This build lacks that task, so it is not posted.
  const open = await openReleaseTasks(ctx);
  if (open.length > 0) return ctx.log('candidate', issue, `not posted, release tasks opened during the build: ${open.map((n) => `#${n}`).join(', ')}`);
  await ctx.github.comment(issue, `Release candidate: ${url}\n\n${changes}`);
  const caption = candidateCaption(release.day, url, trackingLink(ctx, issue), pr, features.length);
  const buttons = [[{ text: 'Ship', data: `factory:ship:${issue}` }]];
  const photoId = await ctx.telegram.sendPhoto(ctx.cfg.committeeChat, join(home, OUT_DIR, 'screenshot.png'), caption, buttons);
  updateState(ctx.statePath, (state) => ({ ...state, release: state.release && { ...state.release, postId: photoId }, postCaptions: { ...state.postCaptions, [photoId]: caption } }));
  // A caption holds 1024 characters, so the whole changelog goes in a message under the post. It splits only past Telegram's message limit.
  await ctx.telegram.sendMessage(ctx.cfg.committeeChat, changes, photoId);
}

// The candidate post. Commands act on it alone, so it says to reply to it, not to the changelog under it.
export function candidateCaption(day: string, url: string, link: string, pr: string, count: number): string {
  const head = `ROAM release candidate ${day}\n\nPlay: ${url}\nPR: ${pr}\nIssue: ${link}`;
  const changes = count === 0 ? 'No changes in this candidate.' : `${count} changes, listed in the message under this post.`;
  const tail = 'Ship publishes it. Reply to this post with "remove #N" to take a change out. Any other reply to it asks for a change and holds the release.';
  return [head, changes, tail].join('\n\n');
}
