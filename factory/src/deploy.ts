import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { updateState } from './state';
import { GAME_DIR, type Ctx } from './types';

const SCOPE = /^[a-z0-9-]+$/;

// Builds in the container, then swaps the built files into the web root with one rename.
export async function buildAndDeploy(ctx: Ctx, clone: string, scope: string, log: string): Promise<string> {
  if (!SCOPE.test(scope)) throw new Error(`bad deploy scope "${scope}"`);
  await ctx.container.shell(clone, 'npm ci && npm run build', log, { SAVE_SCOPE: scope });
  const target = `${ctx.cfg.webRoot}/${scope}`;
  const staging = `${ctx.cfg.webRoot}/.${scope}.new`;
  mkdirSync(ctx.cfg.webRoot, { recursive: true });
  rmSync(staging, { recursive: true, force: true });
  cpSync(`${clone}/${GAME_DIR}/dist`, staging, { recursive: true });
  rmSync(target, { recursive: true, force: true });
  renameSync(staging, target);
  return `${ctx.cfg.publicUrl}/${scope}/`;
}

export async function deployDev(ctx: Ctx, log: string): Promise<string> {
  const dir = `${ctx.cfg.home}/work/dev-build`;
  rmSync(dir, { recursive: true, force: true });
  await ctx.repo.prepareWorkClone('dev', 'dev', dir);
  return buildAndDeploy(ctx, dir, 'dev', log);
}

// The testing stage calls this after it deploys a build, so cleanup keeps the folder while the card waits in Approval.
export function recordBuild(statePath: string, issue: number, name: string): void {
  updateState(statePath, (state) => ({ ...state, builds: { ...state.builds, [String(issue)]: name } }));
}

// Deletes every folder in the web root except dev and the kept builds. Returns the names it removed.
export function removeStaleBuilds(webRoot: string, keep: Set<string>, log: (msg: string) => void): string[] {
  if (!existsSync(webRoot)) return [];
  const stale = readdirSync(webRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name !== 'dev' && !keep.has(entry.name));
  for (const entry of stale) {
    rmSync(join(webRoot, entry.name), { recursive: true, force: true });
    log(`removed stale build ${entry.name}`);
  }
  return stale.map((entry) => entry.name);
}
