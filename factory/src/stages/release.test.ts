import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { readState } from '../state';
import { ROOT, fake, reset } from './test-fakes';
import { release } from './release';

beforeEach(reset);

describe('release', () => {
  it('only records the time when dev has nothing new', async () => {
    const f = fake();
    await release(f.ctx, ROOT);
    expect(readState(f.ctx.statePath).lastRelease).toBe('2026-09-29T10:00:00.000Z');
    expect(f.calls).toEqual(['sync']);
  });

  it('merges main before itch and posts publicly last', async () => {
    const f = fake();
    f.changelog = ['Merge issue 3: faster trucks'];
    f.agentWrites = { 'release.md': 'Trucks are faster.', 'screenshot.png': 'png' };
    await release(f.ctx, ROOT);
    const order = f.calls.map((call) => call.split(' ').slice(0, 3).join(' '));
    const at = (name: string) => order.findIndex((call) => call.startsWith(name));
    expect(at('merge dev main')).toBeLessThan(at('push main'));
    expect(at('push main')).toBeLessThan(at('run npm run'));
    expect(f.calls.filter((call) => call.startsWith('run npm')).at(-1)).toBe('run npm run itch');
    expect(at('run npm run')).toBeLessThan(at('photo public'));
    expect(at('photo public')).toBeLessThan(at('message public'));
    expect(at('message public')).toBeLessThan(at('message committee'));
    expect(lstatSync(join(ROOT, 'repo', 'game', '.env')).isSymbolicLink()).toBe(true);
  });
});

