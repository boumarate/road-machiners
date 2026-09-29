import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAndDeploy } from './deploy';
import type { Ctx } from './types';

function setup(): { ctx: Ctx; clone: string; webRoot: string; shells: string[][] } {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(join('tmp', 'factory-deploy-'));
  const clone = join(root, 'clone');
  const webRoot = join(root, 'web');
  mkdirSync(join(clone, 'game', 'dist'), { recursive: true });
  writeFileSync(join(clone, 'game', 'dist', 'index.html'), 'new');
  const shells: string[][] = [];
  const container = { agent: async () => {}, shell: async (c: string, s: string, l: string, e?: Record<string, string>) => { shells.push([c, s, l, JSON.stringify(e)]); } };
  const ctx = { cfg: { webRoot, publicUrl: 'http://x/play' }, container } as unknown as Ctx;
  return { ctx, clone, webRoot, shells };
}

describe('buildAndDeploy', () => {
  it('rejects a bad scope before building', async () => {
    const { ctx, clone, shells } = setup();
    await expect(buildAndDeploy(ctx, clone, '../evil', '/l')).rejects.toThrow('bad deploy scope');
    expect(shells).toHaveLength(0);
  });

  it('builds with the scope and replaces the old deploy', async () => {
    const { ctx, clone, webRoot, shells } = setup();
    mkdirSync(join(webRoot, 'dev'), { recursive: true });
    writeFileSync(join(webRoot, 'dev', 'old.html'), 'old');
    const url = await buildAndDeploy(ctx, clone, 'dev', '/l');
    expect(url).toBe('http://x/play/dev/');
    expect(shells[0]).toEqual([clone, 'npm ci && npm run build', '/l', '{"SAVE_SCOPE":"dev"}']);
    expect(readFileSync(join(webRoot, 'dev', 'index.html'), 'utf8')).toBe('new');
    expect(existsSync(join(webRoot, 'dev', 'old.html'))).toBe(false);
    expect(existsSync(join(webRoot, '.dev.new'))).toBe(false);
  });
});
