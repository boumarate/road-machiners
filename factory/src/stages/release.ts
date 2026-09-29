import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { must } from '../exec';
import { updateState } from '../state';
import { GAME_DIR, OUT_DIR, type Ctx } from '../types';
import { agentHome, fillPrompt, readOutput, resetOutputs } from './common';

const SERVER_TRIES = 60;

function releaseLog(ctx: Ctx): string {
  const dir = join(ctx.cfg.home, 'logs');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'release.log');
}

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

// Builds main in a fresh clone inside the container, so build code never runs next to the butler key.
// The empty save scope keeps the itch save key. Only the butler call gets the key.
async function publish(ctx: Ctx, day: string): Promise<void> {
  await ctx.repo.merge('dev', 'main', `Release ${day}`);
  await ctx.repo.push('main');
  const dir = join(ctx.cfg.home, 'work', 'release-main');
  rmSync(dir, { recursive: true, force: true });
  await ctx.repo.prepareWorkClone('main', 'main', dir);
  const log = releaseLog(ctx);
  await ctx.container.shell(dir, 'npm ci && npm run build', log, { SAVE_SCOPE: '' });
  const version = await ctx.repo.headHash('main');
  const { itchTarget, butlerKey } = itchKeys(ctx);
  const args = ['push', join(dir, GAME_DIR, 'dist'), `${itchTarget}:html5`, '--userversion', version];
  must(await ctx.run('butler', args, { env: { BUTLER_API_KEY: butlerKey }, logPath: log }), 'butler push');
}

// Ships dev to main and itch.io, then posts the changelog. Nothing new on dev means nothing ships.
// Checked first, so a release without them stops before it merges anything into main.
function itchKeys(ctx: Ctx): { itchTarget: string; butlerKey: string } {
  const { itchTarget, butlerKey } = ctx.cfg;
  if (!itchTarget || !butlerKey) throw new Error('A release needs ITCH_TARGET and BUTLER_API_KEY in factory/.env.');
  return { itchTarget, butlerKey };
}

export async function release(ctx: Ctx): Promise<void> {
  const now = ctx.now();
  updateState(ctx.statePath, (state) => ({ ...state, lastRelease: now.toISOString() }));
  itchKeys(ctx);
  await ctx.repo.sync();
  const changelog = await ctx.repo.mergeLog('dev', 'main');
  if (changelog.length === 0) {
    ctx.log('release', null, 'nothing new on dev, skipped');
    return;
  }
  const dir = join(ctx.cfg.home, 'work', 'release');
  rmSync(dir, { recursive: true, force: true });
  await ctx.repo.prepareWorkClone('dev', 'dev', dir);
  const home = agentHome(dir, GAME_DIR);
  resetOutputs(home);
  writeFileSync(join(home, OUT_DIR, 'changelog.md'), changelog.join('\n') + '\n');
  const log = releaseLog(ctx);
  await ctx.container.shell(dir, PLAYTEST_SCRIPT, log);
  await ctx.container.agent({ clone: dir, dir: GAME_DIR, model: ctx.cfg.buildModel, prompt: fillPrompt('release', {}), log });
  const description = readOutput(home, 'release.md');
  if (description === null) throw new Error('release agent wrote no .factory/release.md');
  const day = now.toISOString().slice(0, 10);
  await publish(ctx, day);
  const channel = ctx.cfg.publicChannel;
  await ctx.telegram.sendPhoto(channel, join(home, OUT_DIR, 'screenshot.png'), `ROAM release ${day}`);
  await ctx.telegram.sendMessage(channel, `${description.trim()}\n\nChanges:\n${changelog.map((line) => `- ${line}`).join('\n')}`);
  await ctx.telegram.sendMessage(ctx.cfg.committeeChat, `Release ${day} shipped with ${changelog.length} changes.`);
  ctx.log('release', null, `shipped ${changelog.length} changes`);
}
