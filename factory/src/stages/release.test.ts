import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { readState } from '../state';
import { ROOT, fake, reset } from './test-fakes';
import { release } from './release';

beforeEach(reset);

describe('release', () => {
  it('stops before merging anything when the itch keys are missing', async () => {
    const f = fake();
    await expect(release(f.ctx)).rejects.toThrow('ITCH_TARGET and BUTLER_API_KEY');
    expect(f.calls).toEqual([]);
  });

  it('only records the time when dev has nothing new', async () => {
    const f = fake();
    Object.assign(f.ctx.cfg, { itchTarget: 'u/g', butlerKey: 'secret' });
    await release(f.ctx);
    expect(readState(f.ctx.statePath).lastRelease).toBe('2026-09-29T10:00:00.000Z');
    expect(f.calls).toEqual(['sync']);
  });

  it('builds main in a fresh clone, pushes with butler alone, and posts publicly last', async () => {
    const f = fake();
    f.changelog = ['Merge issue 3: faster trucks'];
    f.agentWrites = { 'release.md': 'Trucks are faster.', 'screenshot.png': 'png' };
    const runs: { cmd: string; args: string[]; env?: Record<string, string> }[] = [];
    f.ctx.run = async (cmd, args, opts) => { runs.push({ cmd, args, env: opts?.env }); f.calls.push(`run ${cmd} ${args.join(' ')}`); return { code: 0, stdout: '', stderr: '' }; };
    f.ctx.repo.headHash = async () => 'abc1234';
    const shells: { script: string; env?: Record<string, string> }[] = [];
    const shell = f.ctx.container.shell;
    f.ctx.container.shell = async (clone, script, log, env) => { shells.push({ script, env }); f.calls.push(`shell ${clone}`); return shell(clone, script, log, env); };
    Object.assign(f.ctx.cfg, { itchTarget: 'u/g', butlerKey: 'secret' });
    await release(f.ctx);
    const at = (name: string) => f.calls.findIndex((call) => call.startsWith(name));
    expect(at('merge dev main')).toBeLessThan(at('push main'));
    expect(at('push main')).toBeLessThan(at('prepare main'));
    expect(at('prepare main')).toBeLessThan(at('run butler'));
    expect(at('run butler')).toBeLessThan(at('photo public'));
    expect(at('photo public')).toBeLessThan(at('message public'));
    expect(at('message public')).toBeLessThan(at('message committee'));
    expect(shells.at(-1)).toEqual({ script: 'npm ci && npm run build', env: { SAVE_SCOPE: '' } });
    expect(runs).toEqual([{ cmd: 'butler', args: ['push', join(ROOT, 'work', 'release-main', 'game', 'dist'), 'u/g:html5', '--userversion', 'abc1234'], env: { BUTLER_API_KEY: 'secret' } }]);
  });

  it('posts nothing publicly when butler fails', async () => {
    const f = fake();
    f.changelog = ['Merge issue 3: faster trucks'];
    f.agentWrites = { 'release.md': 'Trucks are faster.', 'screenshot.png': 'png' };
    f.ctx.run = async () => ({ code: 1, stdout: '', stderr: 'bad key' });
    f.ctx.repo.headHash = async () => 'abc1234';
    await expect(release(f.ctx)).rejects.toThrow('butler push failed');
    expect(f.calls.some((call) => call.startsWith('photo') || call.startsWith('message'))).toBe(false);
  });
});
