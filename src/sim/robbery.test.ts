import { describe, expect, it } from 'vitest';
import { STATE_TURNS } from '../data/npcs';
import type { TraitId } from '../data/npcs';
import { addGoods } from './inventory';
import { thinkNpc } from './npc-activities';
import { optionWeights, vehicleDanger } from './npc-decisions';
import { NPC_BEHAVIOR, TRAITS } from '../data/npcs';
import { RULES } from '../data/rules';
import { resolveDestroyed } from './combat';
import { checkKnockout } from './defeat';
import { corePart, mountedParts } from './grid';
import { addState, advanceStates, stateOf } from './states';
import { addVehicle, emptyWorld, forceOption, npcBrain } from './testkit';
import type { NpcActivity, Vehicle, World } from './types';
import type { Vec } from './vec';
import { cloneWorld } from './world';
import { REGION } from '../data/region';
import { siteGates } from './sites';

// A gate of Bowl. The robbery spots below lie outside Bowl's wall, north of the gate: one within guard range and one
// past it.
const BOWL = REGION.towns[0];
const GATE = siteGates(BOWL)[0];
// A point d tiles out from the Bowl gate, away from the town.
function outFromGate(d: number): Vec {
  const k = d / BOWL.radius;
  return { x: GATE.x + (GATE.x - BOWL.pos.x) * k, y: GATE.y + (GATE.y - BOWL.pos.y) * k };
}
const GUARDED = RULES.guards.range / 2;
const UNGUARDED = RULES.guards.range + 4;

function addScumbag(w: World, pos: Vec, parts = ['mg', 'stockEngine'], traits: TraitId[] = ['scavenger', 'scumbag']): Vehicle {
  const v = addVehicle(w, 'scavengers', 'scout', parts, pos);
  v.brain = npcBrain('scavenger', pos, traits);
  return v;
}

// The lowest danger a sighting can perceive.
const lowest = (w: World, v: Vehicle) => vehicleDanger(w, v) * (1 - NPC_BEHAVIOR.dangerSpread);

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

type Setup = () => { w: World; robber: Vehicle; target: Vehicle };

// Worlds where rob is unavailable for one reason, and everything else would allow it.
const UNAVAILABLE: Record<string, Setup> = {
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
  unarmed: () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const robber = addScumbag(w, { x: 10, y: 10 });
    robber.items = robber.items.filter((it) => it.kind !== 'part' || it.part.defId !== 'mg');
    return { w, robber, target: addPrey(w, { x: 15, y: 10 }) };
  },
  noLoot: () => {
    const w = emptyWorld({ x: 200, y: 200 });
    return { w, robber: addScumbag(w, { x: 10, y: 10 }), target: addPrey(w, { x: 15, y: 10 }, [], 0) };
  },
};

// Worlds where one robbery judgment fails and the others pass.
const JUDGED: Record<string, Setup> = {
  // Heavier guns and far more HP than the robber's scout.
  strong: () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const target = addVehicle(w, 'traders', 'carrier', ['tankGun', 'plates'], { x: 15, y: 10 });
    return { w, robber: addScumbag(w, { x: 10, y: 10 }), target };
  },
  robberAtGate: () => {
    const w = emptyWorld({ x: 200, y: 200 });
    return { w, robber: addScumbag(w, outFromGate(GUARDED)), target: addPrey(w, outFromGate(UNGUARDED)) };
  },
  targetAtGate: () => {
    const w = emptyWorld({ x: 200, y: 200 });
    return { w, robber: addScumbag(w, outFromGate(UNGUARDED)), target: addPrey(w, outFromGate(GUARDED)) };
  },
};

function passing() {
  const w = emptyWorld({ x: 200, y: 200 });
  return { w, robber: addScumbag(w, { x: 10, y: 10 }), target: addPrey(w, { x: 15, y: 10 }) };
}

// The rob weight a scumbag gives the target when every judgment passes.
const FULL_ROB = TRAITS.scumbag.weights.preySeen!.rob!.add!;

const robWeight = (w: World, robber: Vehicle, target: Vehicle, danger: number) => optionWeights(w, robber, 'preySeen', target.id, danger).rob;

describe('robbery checks', () => {
  it('a weaker truck with loot in sight away from towns gets the full rob weight', () => {
    const { w, robber, target } = passing();
    expect(robWeight(w, robber, target, vehicleDanger(w, target))).toBe(FULL_ROB);
    // Beside the gate, but both past guard range, passes too.
    const far = emptyWorld({ x: 200, y: 200 });
    expect(robWeight(far, addScumbag(far, outFromGate(UNGUARDED)), addPrey(far, outFromGate(UNGUARDED + 5)), 0)).toBe(FULL_ROB);
  });

  for (const [name, make] of Object.entries(UNAVAILABLE)) {
    it(`makes rob unavailable when only ${name} fails`, () => {
      const { w, robber, target } = make();
      expect(optionWeights(w, robber, 'preySeen', target.id, lowest(w, target))).not.toHaveProperty('rob');
    });
  }

  for (const [name, make] of Object.entries(JUDGED)) {
    it(`lowers the rob weight when only ${name} fails`, () => {
      const { w, robber, target } = make();
      const weight = robWeight(w, robber, target, lowest(w, target))!;
      expect(weight).toBeGreaterThan(0);
      expect(weight).toBeLessThanOrEqual(FULL_ROB * 0.1);
    });
  }

  it('a player truck with loot gets the full rob weight only when its guns are weaker', () => {
    const w = emptyWorld({ x: 15, y: 10 });
    const me = w.vehicles[0];
    const robber = addScumbag(w, { x: 10, y: 10 }, ['autocannon', 'stockEngine']);
    expect(robWeight(w, robber, me, vehicleDanger(w, me))).toBe(FULL_ROB);
    // Out of the armed scumbag's group, so the bare one judges by its own guns alone. With none, it cannot rob.
    const bare = addScumbag(w, { x: 15, y: 25 }, ['stockEngine']);
    expect(optionWeights(w, bare, 'preySeen', me.id, lowest(w, me))).not.toHaveProperty('rob');
  });
});

describe('danger', () => {
  it('a tank outscores a scout', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const tank = addVehicle(w, 'raiders', 'carrier', ['tankGun', 'plates'], { x: 10, y: 10 });
    const scout = addVehicle(w, 'raiders', 'scout', ['mg'], { x: 20, y: 10 });
    expect(vehicleDanger(w, tank)).toBeGreaterThan(vehicleDanger(w, scout) * 3);
  });

  it('a half-HP tank scores about half', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const tank = addVehicle(w, 'raiders', 'carrier', ['tankGun', 'plates'], { x: 10, y: 10 });
    const full = vehicleDanger(w, tank);
    for (const part of [...mountedParts(tank, 'core'), ...mountedParts(tank, 'armor')]) part.hp = Math.ceil(part.hp / 2);
    expect(vehicleDanger(w, tank) / full).toBeGreaterThan(0.45);
    expect(vehicleDanger(w, tank) / full).toBeLessThan(0.55);
  });

  it('a truck with no working gun has no danger', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const scout = addVehicle(w, 'raiders', 'scout', ['mg'], { x: 10, y: 10 });
    mountedParts(scout, 'weapon')[0].hp = 0;
    expect(vehicleDanger(w, scout)).toBe(0);
  });
});

describe('scumbag robbery', () => {
  it('a scumbag robs an equal truck on some seeds, and rarely a clearly stronger one', () => {
    const count = (make: (w: World) => Vehicle) => {
      const w = emptyWorld({ x: 200, y: 200 });
      const robber = addScumbag(w, { x: 10, y: 10 });
      const target = make(w);
      let robs = 0;
      for (let seed = 0; seed < 200; seed++) {
        const x = cloneWorld(w);
        x.rngState = seed;
        const r = find(x, robber.id);
        thinkNpc(x, r);
        if (isRob(r.brain!.goals.at(-1), target.id)) robs++;
      }
      return robs;
    };
    const equal = count((w) => addPrey(w, { x: 15, y: 10 }, ['mg', 'stockEngine']));
    const strong = count((w) => addVehicle(w, 'traders', 'carrier', ['tankGun', 'plates'], { x: 15, y: 10 }));
    expect(equal).toBeGreaterThan(0);
    expect(strong).toBeLessThan(20);
    expect(strong).toBeLessThan(equal);
  });

  it('a scumbag robs a weak loaded truck on some seeds, never when rob is unavailable, and rarely when a judgment fails', () => {
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
    for (const make of Object.values(UNAVAILABLE)) {
      const bad = make();
      for (let seed = 0; seed < 20; seed++) {
        const x = cloneWorld(bad.w);
        x.rngState = seed;
        const r = find(x, bad.robber.id);
        thinkNpc(x, r);
        expect(isRob(r.brain!.goals.at(-1), bad.target.id)).toBe(false);
      }
    }
    for (const make of Object.values(JUDGED)) {
      const judged = make();
      let rare = 0;
      for (let seed = 0; seed < 100; seed++) {
        const x = cloneWorld(judged.w);
        x.rngState = seed;
        const r = find(x, judged.robber.id);
        thinkNpc(x, r);
        if (isRob(r.brain!.goals.at(-1), judged.target.id)) rare++;
      }
      expect(rare).toBeLessThan(10);
    }
  });

  it('a scavenger without scumbag robs a weak loaded truck at about 1%', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const robber = addScumbag(w, { x: 10, y: 10 }, ['mg', 'stockEngine'], ['scavenger']);
    const target = addPrey(w, { x: 15, y: 10 });
    expect(robWeight(w, robber, target, vehicleDanger(w, target))).toBe(0);
    const seeds = 2000;
    let robs = 0;
    for (let seed = 0; seed < seeds; seed++) {
      const x = cloneWorld(w);
      x.rngState = seed;
      const r = find(x, robber.id);
      thinkNpc(x, r);
      if (isRob(r.brain!.goals.at(-1), target.id)) robs++;
    }
    expect(robs / seeds).toBeGreaterThan(0.003);
    expect(robs / seeds).toBeLessThan(0.02);
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

  it('a robber keeps its rob goal while its victim stays in sight, with no hostileSeen roll on the victim', () => {
    const { w, robber, target } = passing();
    robber.brain!.goals = [{ kind: 'scavenge', targetId: 'salvage-yard', destination: { x: 100, y: 100 }, phase: 'travel', reason: 'search a known salvage site' }];
    forceOption('preySeen', 'rob');
    // A hostileSeen roll on the victim would almost surely flee.
    forceOption('hostileSeen', 'flee');
    thinkNpc(w, robber);
    for (let turn = 0; turn < 5; turn++) {
      w.turn++;
      w.events = [];
      thinkNpc(w, robber);
      expect(isRob(robber.brain!.goals.at(-1), target.id)).toBe(true);
      expect(w.events.filter((e) => e.t === 'activity')).toEqual([]);
    }
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

  it('a failed robbery lowers the rob weight against the same target', () => {
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
    const again = robWeight(w, robber, target, vehicleDanger(w, target))!;
    expect(again).toBeGreaterThan(0);
    expect(again).toBeLessThan(robWeight(w, robber, other, vehicleDanger(w, other))! * 0.05);
  });
});

describe('prey rolls', () => {
  it('a scavenger without scumbag rolls once on a weak loaded truck', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const scav = addScumbag(w, { x: 10, y: 10 }, ['mg', 'stockEngine'], ['scavenger']);
    scav.brain!.goals = [{ kind: 'scavenge', targetId: 'salvage-yard', destination: { x: 100, y: 100 }, phase: 'travel', reason: 'search a known salvage site' }];
    const target = addPrey(w, { x: 15, y: 10 });
    const rng = w.rngState;
    thinkNpc(w, scav);
    expect(w.rngState).not.toBe(rng);
    expect(scav.brain!.noticed).toHaveProperty([`preySeen:${target.id}`]);
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
