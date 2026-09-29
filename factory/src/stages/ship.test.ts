import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_STATE, readState, writeState } from '../state';
import type { Card, ReleaseState } from '../types';
import { ROOT, fake, reset, type Fake } from './test-fakes';

vi.mock('../deploy', () => ({ deployDev: async () => 'https://play.test/dev/' }));
const { ship } = await import('./ship');

const RELEASE: ReleaseState = { issue: 11, branch: 'release/2026-09-29', day: '2026-09-29', postId: 42, removed: [6] };
const done = (issue: number, labels: string[] = []): Card => ({ itemId: `i${issue}`, issue, column: 'Done', labels });

beforeEach(() => {
  reset();
  writeState(fake().ctx.statePath, { ...structuredClone(EMPTY_STATE), release: RELEASE, pendingShip: 'Ann', builds: { '11': 'rc', '3': 'aaa1111' } });
  const out = join(ROOT, 'work', 'release-candidate', 'game', '.factory');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'screenshot.png'), 'png');
  writeFileSync(join(out, 'release.md'), 'Trucks are faster.\n');
});

function shippable(): Fake {
  const f = fake();
  Object.assign(f.ctx.cfg, { itchTarget: 'u/g', butlerKey: 'secret' });
  f.changelog = ['Merge issue #3: faster trucks', 'Merge issue #6: gone'];
  f.cards = [{ itemId: 'i11', issue: 11, column: 'Approval', labels: ['release'] }, done(12, ['release-task', 'maintenance'])];
  return f;
}

describe('ship', () => {
  it('merges, builds main in a fresh clone, pushes with butler alone, and posts publicly only afterwards', async () => {
    const f = shippable();
    const runs: { cmd: string; args: string[]; env?: Record<string, string> }[] = [];
    f.ctx.run = async (cmd, args, opts) => { runs.push({ cmd, args, env: opts?.env }); f.calls.push(`run ${cmd}`); return { code: 0, stdout: '', stderr: '' }; };
    const shells: { script: string; env?: Record<string, string> }[] = [];
    f.ctx.container.shell = async (clone, script, _log, env) => { shells.push({ script, env }); f.calls.push(`shell ${clone}`); };
    await ship(f.ctx, 11, 'Ann');
    const at = (name: string) => f.calls.findIndex((call) => call.startsWith(name));
    expect(at('sync release/2026-09-29')).toBeLessThan(at('merge release/2026-09-29 main'));
    expect(at('merge release/2026-09-29 main')).toBeLessThan(at('push main'));
    expect(at('push main')).toBeLessThan(at('prepare main'));
    expect(at('prepare main')).toBeLessThan(at('run butler'));
    expect(at('run butler')).toBeLessThan(at('photo public'));
    expect(at('photo public')).toBeLessThan(at('message public'));
    expect(at('message public')).toBeLessThan(at('merge main dev'));
    expect(at('merge main dev')).toBeLessThan(at('push dev'));
    expect(shells).toEqual([{ script: 'npm ci && npm run build', env: { SAVE_SCOPE: '' } }]);
    expect(runs).toEqual([{ cmd: 'butler', args: ['push', join(ROOT, 'work', 'release-main', 'game', 'dist'), 'u/g:html5', '--userversion', 'abc1234'], env: { BUTLER_API_KEY: 'secret' } }]);
    const publicNote = f.calls.find((call) => call.startsWith('message public')) ?? '';
    expect(publicNote).toContain('Trucks are faster.');
    expect(publicNote).toContain('- #3 faster trucks');
    expect(publicNote).not.toContain('#6');
  });

  it('closes the tracking issue, clears the release and the rc build, and tells the committee', async () => {
    const f = shippable();
    await ship(f.ctx, 11, 'Ann');
    expect(f.calls).toContain('close completed');
    expect(f.calls).toContain('move Done');
    expect(f.calls.at(-1)).toBe('message committee - Release 2026-09-29 shipped with 1 changes.');
    const state = readState(f.ctx.statePath);
    expect(state.release).toBeNull();
    expect(state.lastRelease).toBe('2026-09-29T10:00:00.000Z');
    expect(state.builds).toEqual({ '3': 'aaa1111' });
  });

  it('stops before it merges anything when the itch keys are missing', async () => {
    const f = shippable();
    Object.assign(f.ctx.cfg, { itchTarget: null, butlerKey: null });
    await expect(ship(f.ctx, 11, 'Ann')).rejects.toThrow('ITCH_TARGET and BUTLER_API_KEY');
    expect(f.calls).toEqual([]);
  });

  it('refuses without a Ship from a member (IV1)', async () => {
    const f = shippable();
    await expect(ship(f.ctx, 11, null)).rejects.toThrow('needs a Ship');
    expect(f.calls.some((call) => call.startsWith('merge'))).toBe(false);
  });

  it('refuses while the release has no current post (IV3)', async () => {
    const f = shippable();
    writeState(f.ctx.statePath, { ...structuredClone(EMPTY_STATE), release: { ...RELEASE, postId: null } });
    await expect(ship(f.ctx, 11, 'Ann')).rejects.toThrow('no current candidate post');
    expect(f.calls.some((call) => call.startsWith('merge'))).toBe(false);
  });

  it('refuses while a release task is outside Done (IV3)', async () => {
    const f = shippable();
    f.cards.push({ itemId: 'i13', issue: 13, column: 'Testing', labels: ['release-task'] });
    await expect(ship(f.ctx, 11, 'Ann')).rejects.toThrow('still open: #13');
    expect(f.calls.some((call) => call.startsWith('merge'))).toBe(false);
  });

  it('refuses when no release is open or another issue is named', async () => {
    const f = shippable();
    await expect(ship(f.ctx, 99, 'Ann')).rejects.toThrow('not the tracking issue');
    writeState(f.ctx.statePath, structuredClone(EMPTY_STATE));
    await expect(ship(f.ctx, 11, 'Ann')).rejects.toThrow('No release is open');
  });

  it('posts nothing publicly when butler fails', async () => {
    const f = shippable();
    f.ctx.run = async () => ({ code: 1, stdout: '', stderr: 'bad key' });
    await expect(ship(f.ctx, 11, 'Ann')).rejects.toThrow('butler push failed');
    expect(f.calls.some((call) => call.startsWith('photo') || call.startsWith('message'))).toBe(false);
    expect(readState(f.ctx.statePath).release).not.toBeNull();
  });
});
