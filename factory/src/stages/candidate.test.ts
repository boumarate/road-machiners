import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_STATE, readState, writeState } from '../state';
import type { ReleaseState } from '../types';
import { fake, reset } from './test-fakes';

const deployed: string[] = [];
vi.mock('../deploy', () => ({
  buildAndDeploy: async (_ctx: unknown, _clone: string, scope: string) => { deployed.push(scope); return `https://play.test/${scope}/`; },
  recordBuild: (_statePath: string, issue: number, name: string) => { deployed.push(`record ${issue} ${name}`); },
}));
const { candidate, candidateCaption } = await import('./candidate');

const RELEASE: ReleaseState = { issue: 11, branch: 'release/2026-09-29', day: '2026-09-29', postId: null, removed: [] };

beforeEach(() => {
  reset();
  deployed.length = 0;
  writeState(fake().ctx.statePath, { ...structuredClone(EMPTY_STATE), release: RELEASE });
});

describe('candidate', () => {
  it('builds the release branch, posts one photo with a Ship button and stores the post id', async () => {
    const f = fake();
    f.changelog = ['Merge issue #3: faster trucks', 'Merge issue #5: louder horn', 'Merge issue #6: gone'];
    writeState(f.ctx.statePath, { ...structuredClone(EMPTY_STATE), release: { ...RELEASE, removed: [6] } });
    f.agentWrites = { 'release.md': 'Trucks are faster.', 'screenshot.png': 'png' };
    await candidate(f.ctx, 11);
    expect(f.calls.filter((call) => !call.startsWith('comment'))).toEqual(['sync release/2026-09-29', 'prepare release/2026-09-29', 'shell', 'agent', 'pr release/2026-09-29 main Release 2026-09-29', 'photo committee']);
    expect(deployed).toEqual(['rc', 'record 11 rc']);
    expect(f.calls.find((call) => call.startsWith('comment'))).toContain('#5 louder horn');
    expect(f.calls.find((call) => call.startsWith('comment'))).not.toContain('#6');
    const photo = f.photos[0];
    expect(photo.buttons).toEqual([[{ text: 'Ship', data: 'factory:ship:11' }]]);
    expect(photo.caption).toContain('Play: https://play.test/rc/');
    expect(photo.caption).toContain('#3 faster trucks\n#5 louder horn');
    expect(readState(f.ctx.statePath).release?.postId).toBe(42);
  });

  it('opens the pull request to main when none is open', async () => {
    const f = fake();
    f.changelog = ['Merge issue #3: faster trucks'];
    f.agentWrites = { 'release.md': 'Notes.', 'screenshot.png': 'png' };
    await candidate(f.ctx, 11);
    expect(f.calls).toContain('pr release/2026-09-29 main Release 2026-09-29');
    expect(f.photos[0].caption).toContain('PR: http://pr');
  });

  it('refuses an issue that is not the tracking issue and posts nothing', async () => {
    const f = fake();
    await expect(candidate(f.ctx, 12)).rejects.toThrow('not the tracking issue');
    expect(f.photos).toEqual([]);
  });

  it('throws when no release is open', async () => {
    const f = fake();
    writeState(f.ctx.statePath, structuredClone(EMPTY_STATE));
    await expect(candidate(f.ctx, 11)).rejects.toThrow('No release is open');
  });

  it('throws when the agent wrote no notes, before it builds anything', async () => {
    const f = fake();
    f.agentWrites = { 'screenshot.png': 'png' };
    await expect(candidate(f.ctx, 11)).rejects.toThrow('no .factory/release.md');
    expect(deployed).toEqual([]);
  });
});

describe('candidateCaption', () => {
  const features = (count: number) => Array.from({ length: count }, (_, index) => ({ issue: index + 1, title: `feature number ${index + 1} with a fairly long title` }));

  it('lists every feature when they fit', () => {
    const caption = candidateCaption('2026-09-29', 'https://p/rc/', 'https://i', 'https://pr', 'Notes.', features(3));
    expect(caption).toContain('#3 feature number 3');
    expect(caption).not.toContain('more, see the issue');
  });

  it('stays inside the Telegram limit and names the features it cut', () => {
    const caption = candidateCaption('2026-09-29', 'https://p/rc/', 'https://i', 'https://pr', 'n'.repeat(3000), features(60));
    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(caption).toMatch(/and \d+ more, see the issue/);
    expect(caption).toContain('#1 feature number 1');
    expect(caption).toContain('Reply "remove #N"');
  });

  it('says so when no feature is left', () => {
    expect(candidateCaption('2026-09-29', 'u', 'i', 'p', 'Notes.', [])).toContain('No features in this candidate.');
  });
});
