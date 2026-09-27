// A long run of ordinary AI traffic (spawning, driving, fighting) through the real physics turn
// pipeline, checking the invariants physics itself does not enforce for free: no negative resources
// or part HP. Physics guarantees no overlap by construction, so this does not re-check that.

import { beforeAll, describe, expect, it } from 'vitest';
import { START_KITS } from '../data/start';
import { hangUp } from '../sim/dialogue';
import { mountedParts } from '../sim/grid';
import type { World } from '../sim/types';
import { endTurn, newWorld, setMoveOrder } from '../sim/world';
import { buildDrive, freeDrive, initPhysics, type Drive } from './drive';
import { physicsMove } from './turn';

beforeAll(async () => {
  await initPhysics();
});

// Plays n turns through the real turn pipeline with physics movement.
function play(w: World, n: number): { w: World } {
  let d = buildDrive(w);
  for (let i = 0; i < n; i++) {
    let next: Drive | null = null;
    w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
    freeDrive(d);
    d = next!;
  }
  freeDrive(d);
  return { w };
}

describe('invariants under AI traffic', () => {
  it('no negative HP, fuel, supplies, health or money over 80 turns', () => {
    let w = setMoveOrder(newWorld(11, START_KITS.standard), { kind: 'stopAt', dest: { x: 45, y: 15 } });
    for (let i = 0; i < 80; i++) {
      // The player hangs up on drivers who radio in, since an open call holds the turn.
      if (w.player.call) w = hangUp(w);
      ({ w } = play(w, 1));
      for (const v of w.vehicles) for (const p of mountedParts(v)) expect(p.hp).toBeGreaterThanOrEqual(0);
      for (const k of ['fuel', 'supplies', 'health', 'money'] as const) expect(w.player[k]).toBeGreaterThanOrEqual(0);
    }
  }, 120_000); // Eighty turns include long-distance traffic across the 600-tile region.
});
