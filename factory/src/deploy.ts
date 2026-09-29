import { cpSync, mkdirSync, renameSync, rmSync } from 'node:fs';
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
