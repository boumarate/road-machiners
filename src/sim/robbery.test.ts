import { describe, expect, it } from 'vitest';
import { STATE_TURNS } from '../data/states';
import type { TraitId } from '../data/npcs';
import { addGoods } from './inventory';
import { thinkNpc } from './npc-activities';
import { optionWeights } from './npc-decisions';
import { isRobberyTarget } from './robbery';
import { addState, advanceStates, stateOf } from './states';
import { addVehicle, emptyWorld, forceOption, npcBrain } from './testkit';
import type { NpcActivity, Vehicle, World } from './types';
import type { Vec } from './vec';
import { cloneWorld } from './world';

// A gate of Bowl. The robbery spots below lie outside Bowl's wall.
const GATE = { x: 106.2, y: 460.2 };

function addScumbag(w: World, pos: Vec, parts = ['mg', 'stockEngine'], traits: TraitId[] = ['scavenger', 'scumbag']): Vehicle {
  const v = addVehicle(w, 'scavengers', 'scout', parts, pos);
  v.brain = npcBrain('scavenger', pos, traits);
  return v;
}

// A truck with no gun and goods on its grid.
function addPrey(w: World, pos: Vec, parts: string[] = [], goods = 2): Vehicle {
  const v = addVehicle(w, 'traders', 'scout', parts, pos);
  if (goods > 0 && addGoods(w, v, 'scrap', goods) < goods) throw new Error('No room for prey goods');
  return v;
}

const find = (w: World, id: string) => w.vehicles.find((v) => v.id === id)!;

function isRob(goal: NpcActivity | undefined, target: string): boolean {
  return goal?.kind === 'fight' && goal.targetId === target && goal.reason === 'rob cargo';
}

// Worlds where one robbery check fails and the others pass.
const FAILING: Record<string, () => { w: World; robber: Vehicle; target: Vehicle }> = {
  unseen: () => {
    const w = emptyWorld({ x: 200, y: 200 });
    return { w, robber: addScumbag(w, { x: 10, y: 10 }), target: addPrey(w, { x: 60, y: 10 }) };
  },
  hostile: () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const robber = addScumbag(w, { x: 10, y: 10 });
    const target = addPrey(w, { x: 15, y: 10 });
    addState(w, 'feud', target.id, robber.id, { kind: 'none' });
    return { w, robber, target };
  },
  noLoot: () => {
    const w = emptyWorld({ x: 200, y: 200 });
    return { w, robber: addScumbag(w, { x: 10, y: 10 }), target: addPrey(w, { x: 15, y: 10 }, [], 0) };
  },
  asStrong: () => {
    const w = emptyWorld({ x: 200, y: 200 });
    return { w, robber: addScumbag(w, { x: 10, y: 10 }), target: addPrey(w, { x: 15, y: 10 }, ['mg']) };
  },
  robberAtGate: () => {
    const w = emptyWorld({ x: 200, y: 200 });
    return { w, robber: addScumbag(w, { x: GATE.x, y: GATE.y - 6 }), target: addPrey(w, { x: GATE.x, y: GATE.y - 12 }) };
  },
  targetAtGate: () => {
    const w = emptyWorld({ x: 200, y: 200 });
    return { w, robber: addScumbag(w, { x: GATE.x, y: GATE.y - 12 }), target: addPrey(w, { x: GATE.x, y: GATE.y - 6 }) };
  },
};

function passing() {
  const w = emptyWorld({ x: 200, y: 200 });
  return { w, robber: addScumbag(w, { x: 10, y: 10 }), target: addPrey(w, { x: 15, y: 10 }) };
}

describe('robbery checks', () => {
  it('a weaker truck with loot in sight away from towns is a target', () => {
    const { w, robber, target } = passing();
    expect(isRobberyTarget(w, robber, target)).toBe(true);
    // The same spot beside the gate, but one gate range further out, passes too.
    const far = emptyWorld({ x: 200, y: 200 });
    expect(isRobberyTarget(far, addScumbag(far, { x: GATE.x, y: GATE.y - 12 }), addPrey(far, { x: GATE.x, y: GATE.y - 17 }))).toBe(true);
  });

  for (const [name, make] of Object.entries(FAILING)) {
    it(`blocks a robbery when only ${name} fails`, () => {
      const { w, robber, target } = make();
      expect(isRobberyTarget(w, robber, target)).toBe(false);
      expect(optionWeights(w, robber, 'preySeen', target.id).rob).toBe(0);
    });
  }

  it('a player truck with loot is a target when its guns are weaker', () => {
    const w = emptyWorld({ x: 15, y: 10 });
    const me = w.vehicles[0];
    const robber = addScumbag(w, { x: 10, y: 10 }, ['autocannon', 'stockEngine']);
    expect(isRobberyTarget(w, robber, me)).toBe(true);
    const even = addScumbag(w, { x: 10, y: 12 });
    expect(isRobberyTarget(w, even, me)).toBe(false);
  });
});

describe('scumbag robbery', () => {
  it('a scumbag robs a weak loaded truck on some seeds, and never when a check fails', () => {
    const { w, robber, target } = passing();
    let robs = 0;
    const seeds = 60;
    for (let seed = 0; seed < seeds; seed++) {
      const x = cloneWorld(w);
      x.rngState = seed;
      const r = find(x, robber.id);
      thinkNpc(x, r);
      if (!isRob(r.brain!.goals.at(-1), target.id)) continue;
      robs++;
      expect(stateOf(x, 'feud', robber.id, target.id)).not.toBeNull();
      expect(x.events).toContainEqual({ t: 'hostile', vehicle: robber.id, against: target.id });
    }
    expect(robs).toBeGreaterThan(0);
    expect(robs).toBeLessThan(seeds);
    for (const make of Object.values(FAILING)) {
      const bad = make();
      for (let seed = 0; seed < 20; seed++) {
        const x = cloneWorld(bad.w);
        x.rngState = seed;
        const r = find(x, bad.robber.id);
        thinkNpc(x, r);
        expect(isRob(r.brain!.goals.at(-1), bad.target.id)).toBe(false);
      }
    }
  });

  it('a scavenger without scumbag never robs', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const robber = addScumbag(w, { x: 10, y: 10 }, ['mg', 'stockEngine'], ['scavenger']);
    const target = addPrey(w, { x: 15, y: 10 });
    expect(optionWeights(w, robber, 'preySeen', target.id).rob).toBe(0);
  });

  it('a scumbag scavenger with no prey still scavenges', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const robber = addScumbag(w, { x: 10, y: 10 });
    let scavenges = 0;
    for (let seed = 0; seed < 50; seed++) {
      const x = cloneWorld(w);
      x.rngState = seed;
      if (thinkNpc(x, find(x, robber.id)).kind === 'scavenge') scavenges++;
    }
    expect(scavenges).toBeGreaterThanOrEqual(45);
  });

  it('a robbery keeps the scavenge goal below it', () => {
    const { w, robber, target } = passing();
    const scavenge: NpcActivity = { kind: 'scavenge', targetId: 'salvage-yard', destination: { x: 100, y: 100 }, phase: 'travel', reason: 'search a known salvage site' };
    robber.brain!.goals = [scavenge];
    forceOption('preySeen', 'rob');
    thinkNpc(w, robber);
    expect(robber.brain!.goals.map((g) => g.kind)).toEqual(['scavenge', 'fight']);
    expect(isRob(robber.brain!.goals[1], target.id)).toBe(true);
    // The target is gone, so the rob goal pops and the scavenge goal is active again.
    w.vehicles = w.vehicles.filter((v) => v.id !== target.id);
    forceOption('resume', 'resume');
    expect(thinkNpc(w, robber)).toMatchObject({ kind: 'scavenge', targetId: 'salvage-yard' });
  });

  it('a failed robbery blocks a new rob roll against the same target', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const robber = addScumbag(w, { x: 10, y: 10 });
    const target = addPrey(w, { x: 80, y: 10 });
    const other = addPrey(w, { x: 10, y: 15 });
    addState(w, 'feud', robber.id, target.id, { kind: 'none' });
    // Out of sight and with no shots, the feud runs out.
    for (let i = 0; i < STATE_TURNS.feud!; i++) {
      w.turn++;
      w.events = [];
      advanceStates(w);
    }
    expect(stateOf(w, 'feud', robber.id, target.id)).toBeNull();
    expect(w.events).toContainEqual(expect.objectContaining({ t: 'stateEnded', ending: 'expired' }));
    const backedOff = stateOf(w, 'backedOff', robber.id, target.id);
    expect(backedOff).not.toBeNull();
    // A state added by a hook waits a turn before it counts down.
    w.turn++;
    advanceStates(w);
    expect(stateOf(w, 'backedOff', robber.id, target.id)?.turnsLeft).toBe(STATE_TURNS.backedOff! - 1);
    target.pos = { x: 15, y: 10 };
    expect(isRobberyTarget(w, robber, target)).toBe(true);
    expect(optionWeights(w, robber, 'preySeen', target.id).rob).toBe(0);
    expect(optionWeights(w, robber, 'preySeen', other.id).rob).toBeGreaterThan(0);
  });
});
