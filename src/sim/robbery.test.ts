import { describe, expect, it } from 'vitest';
import { STATE_TURNS } from '../data/states';
import type { TraitId } from '../data/npcs';
import { addGoods } from './inventory';
import { thinkNpc } from './npc-activities';
import { optionWeights } from './npc-decisions';
import { isRobberyTarget } from './robbery';
import { resolveDestroyed } from './combat';
import { checkKnockout } from './defeat';
import { corePart } from './grid';
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
    addState(w, 'feud', target.id, robber.id, { kind: 'feud', robbery: false });
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

  it('a robber stops its search to rob', () => {
    const { w, robber, target } = passing();
    robber.brain!.goals = [{ kind: 'scavenge', targetId: 'salvage-yard', destination: { x: 100, y: 100 }, phase: 'act', reason: 'search a known salvage site' }];
    robber.job = { kind: 'search', stockId: 'salvage-yard', turnsLeft: 3, total: 3 };
    forceOption('preySeen', 'rob');
    thinkNpc(w, robber);
    expect(isRob(robber.brain!.goals.at(-1), target.id)).toBe(true);
    expect(robber.job).toBeNull();
    expect(w.events).toContainEqual(expect.objectContaining({ t: 'job', vehicle: robber.id, outcome: 'cancelled' }));
  });

  it('a failed robbery blocks a new rob roll against the same target', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const robber = addScumbag(w, { x: 10, y: 10 });
    const target = addPrey(w, { x: 80, y: 10 });
    const other = addPrey(w, { x: 10, y: 15 });
    addState(w, 'feud', robber.id, target.id, { kind: 'feud', robbery: true });
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

describe('no-choice decisions', () => {
  it('a scavenger without scumbag seeing a weak loaded truck draws no RNG and notices nothing', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const scav = addScumbag(w, { x: 10, y: 10 }, ['mg', 'stockEngine'], ['scavenger']);
    scav.brain!.goals = [{ kind: 'scavenge', targetId: 'salvage-yard', destination: { x: 100, y: 100 }, phase: 'travel', reason: 'search a known salvage site' }];
    const target = addPrey(w, { x: 15, y: 10 });
    expect(isRobberyTarget(w, scav, target)).toBe(true);
    const rng = w.rngState;
    thinkNpc(w, scav);
    expect(w.rngState).toBe(rng);
    expect(Object.keys(scav.brain!.noticed)).toEqual([]);
  });
});

describe('looting', () => {
  const SCAVENGE: NpcActivity = { kind: 'scavenge', targetId: 'salvage-yard', destination: { x: 100, y: 100 }, phase: 'travel', reason: 'search a known salvage site' };

  // Runs the part of a turn that ends states after a kill.
  function killTurn(w: World): void {
    w.turn++;
    w.events = [];
    resolveDestroyed(w);
    advanceStates(w);
  }

  it('a scumbag that wins against an NPC loots its wreck, with its scavenge goal still below', () => {
    const { w, robber, target } = passing();
    robber.brain!.goals = [{ ...SCAVENGE }];
    forceOption('preySeen', 'rob');
    thinkNpc(w, robber);
    expect(stateOf(w, 'feud', robber.id, target.id)?.data).toEqual({ kind: 'feud', robbery: true });
    corePart(target, 'cab').hp = 0;
    killTurn(w);
    const stock = `wreck-${target.id}`;
    expect(w.salvage.some((s) => s.id === stock)).toBe(true);
    expect(robber.brain!.goals.at(-1)).toMatchObject({ kind: 'loot', targetId: stock });
    expect(robber.brain!.goals[0]).toMatchObject({ kind: 'scavenge', targetId: 'salvage-yard' });
    // The loot goal drives the robber this turn. Once the stock is gone, the rob and loot goals pop, and the
    // scavenge goal is active again.
    expect(thinkNpc(w, robber)).toMatchObject({ kind: 'loot', targetId: stock });
    w.salvage = w.salvage.filter((s) => s.id !== stock);
    forceOption('resume', 'resume');
    expect(thinkNpc(w, robber)).toMatchObject({ kind: 'scavenge', targetId: 'salvage-yard' });
  });

  it('a scumbag that knocks out the player loots the knockout stock', () => {
    const w = emptyWorld({ x: 15, y: 10 });
    const me = w.vehicles[0];
    const robber = addScumbag(w, { x: 10, y: 10 }, ['autocannon', 'stockEngine']);
    robber.brain!.goals = [{ ...SCAVENGE }];
    addState(w, 'feud', robber.id, me.id, { kind: 'feud', robbery: true });
    w.turn++;
    corePart(me, 'cab').hp = 0;
    checkKnockout(w);
    const stock = w.salvage.find((s) => s.id.startsWith(`wreck-${me.id}-`));
    expect(stock).toBeDefined();
    expect(robber.brain!.goals.map((g) => g.kind)).toEqual(['scavenge', 'loot']);
    expect(robber.brain!.goals[1].targetId).toBe(stock!.id);
  });

  it('a provoked feud that is fulfilled pushes no loot goal', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const npc = addScumbag(w, { x: 10, y: 10 });
    npc.brain!.goals = [{ ...SCAVENGE }];
    const foe = addPrey(w, { x: 15, y: 10 });
    addState(w, 'feud', npc.id, foe.id, { kind: 'feud', robbery: false });
    corePart(foe, 'cab').hp = 0;
    killTurn(w);
    expect(stateOf(w, 'feud', npc.id, foe.id)).toBeNull();
    expect(w.salvage.some((s) => s.id === `wreck-${foe.id}`)).toBe(true);
    expect(npc.brain!.goals.map((g) => g.kind)).toEqual(['scavenge']);
  });
});
