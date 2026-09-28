import { HUNT, MIN_CHANCE, NPC_BEHAVIOR } from '../data/npcs';
import { REGION } from '../data/region';
import { PERK_NUMBERS } from '../data/skills';
import { describe, expect, it, onTestFinished } from 'vitest';
import { TERRAIN } from '../data/terrain';
import { corePart, coreParts, mountedParts } from './grid';
import { maxHp } from './wear';
import { addGoods } from './inventory';
import { decide, huntingGrounds, isWeak, optionChances, optionWeights, vehicleDanger } from './npc-decisions';
import { siteLootTable } from './salvage';
import { sitePads } from './sites';
import { noteHurt, thinkNpc, topGoal } from './npc-activities';
import { addState, stateOf } from './states';
import { addVehicle, emptyWorld, forceOption, npcBrain } from './testkit';
import type { TraitId } from '../data/npcs';
import type { Faction, Vehicle, World } from './types';
import { dist, polylineDist, type Vec } from './vec';
import { refreshVision } from './vision';
import { cloneWorld } from './world';

function addNpc(w: World, faction: Faction, templateId: string, traits: TraitId[], pos: Vec, parts = ['mg', 'stockEngine']): Vehicle {
  const v = addVehicle(w, faction, 'scout', parts, pos);
  v.brain = npcBrain(templateId, pos, traits);
  return v;
}

const find = (w: World, id: string) => w.vehicles.find((v) => v.id === id)!;

describe('decision weights', () => {
  it('gives every available option at least MIN_CHANCE and shares the rest by weight', () => {
    const rare = optionChances({ keep: 1, rob: 0 });
    expect(rare.keep).toBeCloseTo(1 - MIN_CHANCE);
    expect(rare.rob).toBeCloseTo(MIN_CHANCE);
    const shares = optionChances({ keep: 3, flee: 1 });
    expect(shares.keep).toBeCloseTo(MIN_CHANCE + (1 - 2 * MIN_CHANCE) * 0.75);
    expect(shares.flee).toBeCloseTo(MIN_CHANCE + (1 - 2 * MIN_CHANCE) * 0.25);
    // With no weight at all, the options share equally.
    for (const share of Object.values(optionChances({ trade: 0, scavenge: 0, wait: 0, raid: 0 }))) expect(share).toBeCloseTo(0.25);
  });

  it('never picks an unavailable option over 500 seeds', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const npc = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 10, y: 10 }, ['stockEngine']);
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 14, y: 10 });
    expect(optionWeights(w, npc, 'hostileSeen', raider.id, vehicleDanger(w, raider))).not.toHaveProperty('fight');
    for (let seed = 0; seed < 500; seed++) {
      w.rngState = seed;
      expect(decide(w, npc, 'hostileSeen', raider.id, vehicleDanger(w, raider))).not.toBe('fight');
    }
  });

  it('picks an available option with no weight at about 1%', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const scav = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 60, y: 30 });
    expect(optionWeights(w, scav, 'contactHeard', w.player.vehicleId, null).investigate).toBe(0);
    const draws = 5000;
    let picked = 0;
    for (let i = 0; i < draws; i++) if (decide(w, scav, 'contactHeard', w.player.vehicleId, null) === 'investigate') picked++;
    expect(picked / draws).toBeGreaterThan(0.005);
    expect(picked / draws).toBeLessThan(0.018);
  });

  it('offers a raid only to raiders', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const raider = addNpc(w, 'raiders', 'buggy', ['raider'], { x: 60, y: 30 });
    const merc = addNpc(w, 'mercs', 'merc', ['merc'], { x: 70, y: 30 });
    expect(optionWeights(w, raider, 'idle', null, null)).toHaveProperty('raid');
    expect(optionWeights(w, merc, 'idle', null, null)).not.toHaveProperty('raid');
  });

  it('keeps with no roll when keep is the only available option', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const raider = addNpc(w, 'raiders', 'buggy', ['raider'], { x: 60, y: 30 });
    // With an empty tank the driver can neither close in on a contact nor drive off.
    raider.resources!.fuel = 0;
    expect(Object.keys(optionWeights(w, raider, 'contactHeard', w.player.vehicleId, null))).toEqual(['keep']);
    const rng = w.rngState;
    expect(decide(w, raider, 'contactHeard', w.player.vehicleId, null)).toBe('keep');
    expect(w.rngState).toBe(rng);
  });

  it('throws on a situation factor at or below zero', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const npc = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 10, y: 10 });
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 14, y: 10 });
    // A miss with no weight and no damage taken gives flee a factor of 0.
    const missFlee = NPC_BEHAVIOR.missFlee;
    NPC_BEHAVIOR.missFlee = 0;
    onTestFinished(() => { NPC_BEHAVIOR.missFlee = missFlee; });
    npc.brain!.hurt = 0;
    expect(() => optionWeights(w, npc, 'attacked', raider.id, null)).toThrow(/factor/);
  });

  it('makes fight unavailable without a working weapon', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const npc = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 10, y: 10 }, ['stockEngine']);
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 14, y: 10 });
    expect(optionWeights(w, npc, 'hostileSeen', raider.id, vehicleDanger(w, raider))).not.toHaveProperty('fight');
  });

  it('raises flee weight when outgunned or damaged', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const npc = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 10, y: 10 }, ['mg', 'stockEngine']);
    const weak = addVehicle(w, 'raiders', 'buggy', [], { x: 14, y: 10 });
    const strong = addVehicle(w, 'raiders', 'scout', ['autocannon'], { x: 14, y: 12 });
    const calm = optionWeights(w, npc, 'hostileSeen', weak.id, vehicleDanger(w, weak)).flee!;
    expect(optionWeights(w, npc, 'hostileSeen', strong.id, vehicleDanger(w, strong)).flee).toBeGreaterThan(calm);
    corePart(npc, 'cab').hp = 1;
    expect(optionWeights(w, npc, 'hostileSeen', weak.id, vehicleDanger(w, weak)).flee).toBeGreaterThan(calm);
  });

  it('does not count a truck weak for one broken wheel', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const npc = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 10, y: 10 });
    coreParts(npc, 'wheel')[0].hp = 0;
    expect(isWeak(w, npc)).toBe(false);
  });

  it('counts a truck weak when it cannot drive', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const npc = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 10, y: 10 });
    corePart(npc, 'transmission').hp = 0;
    expect(isWeak(w, npc)).toBe(true);
  });

  it('counts a truck weak when most of it is broken, even with a sound cab', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const npc = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 10, y: 10 }, ['mg', 'stockEngine', 'plates']);
    const cab = corePart(npc, 'cab');
    for (const part of mountedParts(npc)) if (part !== cab) part.hp = Math.floor(maxHp(part) * 0.2);
    expect(isWeak(w, npc)).toBe(true);
  });

  it('a coward flees from an equal truck more often than a plain scavenger', () => {
    const flees = (traits: TraitId[]) => {
      const w = emptyWorld({ x: 80, y: 80 });
      const npc = addNpc(w, 'scavengers', 'scavenger', traits, { x: 10, y: 10 });
      addNpc(w, 'raiders', 'buggy', ['raider'], { x: 14, y: 10 });
      let count = 0;
      for (let seed = 0; seed < 100; seed++) {
        const x = cloneWorld(w);
        x.rngState = seed;
        if (thinkNpc(x, find(x, npc.id)).kind === 'flee') count++;
      }
      return count;
    };
    const plain = flees(['scavenger']);
    expect(flees(['scavenger', 'coward'])).toBeGreaterThan(plain + 20);
  });

  it('adds fight weight only against the feud target', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const npc = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 10, y: 10 });
    const a = addVehicle(w, 'raiders', 'buggy', [], { x: 14, y: 10 });
    const b = addVehicle(w, 'raiders', 'buggy', [], { x: 14, y: 12 });
    const before = optionWeights(w, npc, 'hostileSeen', a.id, vehicleDanger(w, a)).fight!;
    addState(w, 'feud', npc.id, a.id, { kind: 'feud', robbery: false });
    expect(optionWeights(w, npc, 'hostileSeen', a.id, vehicleDanger(w, a)).fight).toBeGreaterThan(before);
    expect(optionWeights(w, npc, 'hostileSeen', b.id, vehicleDanger(w, b)).fight).toBe(before);
  });

  it('a trader rarely starts a fight', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const trader = addNpc(w, 'traders', 'trader', ['trader'], { x: 10, y: 10 }, ['autocannon', 'stockEngine']);
    addVehicle(w, 'raiders', 'buggy', [], { x: 14, y: 10 });
    const seeds = 1000;
    let fights = 0;
    for (let seed = 0; seed < seeds; seed++) {
      const x = cloneWorld(w);
      x.rngState = seed;
      if (thinkNpc(x, find(x, trader.id)).kind === 'fight') fights++;
    }
    expect(fights).toBeGreaterThan(0);
    expect(fights / seeds).toBeLessThan(0.03);
  });

  it('a tower the player turned down offers a tow rarely', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const trader = addNpc(w, 'traders', 'trader', ['trader'], { x: 36, y: 30 });
    const me = w.player.vehicleId;
    w.player.fuel = 0;
    const eager = optionChances(optionWeights(w, trader, 'strandedSeen', me, null)).tow!;
    addState(w, 'turnedDown', trader.id, me, { kind: 'none' });
    const turnedDown = optionChances(optionWeights(w, trader, 'strandedSeen', me, null)).tow!;
    expect(turnedDown).toBeGreaterThanOrEqual(MIN_CHANCE);
    expect(turnedDown).toBeLessThan(0.03);
    expect(eager).toBeGreaterThan(0.5);
  });

  it('a turned-down tower that picks tow again gets over it and keeps its tow goal', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const trader = addNpc(w, 'traders', 'trader', ['trader'], { x: 36, y: 30 });
    const me = w.player.vehicleId;
    w.player.fuel = 0;
    addState(w, 'turnedDown', trader.id, me, { kind: 'none' });
    forceOption('strandedSeen', 'tow');
    expect(thinkNpc(w, trader)).toMatchObject({ kind: 'tow', targetId: me });
    expect(stateOf(w, 'turnedDown', trader.id, me)).toBeNull();
    expect(thinkNpc(w, trader)).toMatchObject({ kind: 'tow', targetId: me });
  });
});

describe('fight back', () => {
  const round = (damage: number) => ({ hit: true, crit: false, offset: 0, hits: [{ part: 'x', damage }] });

  // A trader shot this turn by a raider in sight for `damage`. A base goal is set, so only the attacked decision
  // rolls. 18 damage is 30% of a cab, three times the hit that gives flee its base weight.
  function shotTrader(traits: TraitId[], damage: number) {
    const w = emptyWorld({ x: 80, y: 80 });
    const trader = addNpc(w, 'traders', 'trader', traits, { x: 10, y: 10 }, ['autocannon', 'stockEngine']);
    trader.brain!.goals = [{ kind: 'wait', targetId: null, destination: null, phase: 'act', reason: 'test base goal' }];
    const raider = addNpc(w, 'raiders', 'buggy', ['raider'], { x: 14, y: 10 });
    w.events = [{ t: 'shot', shooter: raider.id, weapon: 'w', target: trader.id, aim: 'body', chance: 1, side: 'front', rounds: [round(damage)] }];
    noteHurt(w);
    w.events = [];
    // The shot's attack record, as combat leaves it.
    trader.brain!.attackers = { [raider.id]: false };
    return { w, trader, raider };
  }

  it('a trader shot by an NPC sometimes fights back and mostly flees', () => {
    const { w, trader, raider } = shotTrader(['trader'], 18);
    const seeds = 400;
    let back = 0;
    let fled = 0;
    for (let seed = 0; seed < seeds; seed++) {
      const x = cloneWorld(w);
      x.rngState = seed;
      const top = thinkNpc(x, find(x, trader.id));
      if (top.kind === 'fight') {
        expect(top).toMatchObject({ targetId: raider.id, reason: 'fight back' });
        back++;
      }
      if (top.kind === 'flee') fled++;
    }
    expect(back / seeds).toBeGreaterThan(0.05);
    expect(fled / seeds).toBeGreaterThan(0.5);
  });

  it('a coward fights back less than a plain trader', () => {
    const plain = shotTrader(['trader'], 18);
    const coward = shotTrader(['trader', 'coward'], 18);
    const back = (s: { w: World; trader: Vehicle; raider: Vehicle }) => optionChances(optionWeights(s.w, s.trader, 'attacked', s.raider.id, vehicleDanger(s.w, s.raider))).fightBack!;
    expect(back(coward)).toBeLessThan(back(plain));
  });

  it('a guard shot fires no attacked decision', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const trader = addNpc(w, 'traders', 'trader', ['trader'], { x: 10, y: 10 }, ['autocannon', 'stockEngine']);
    trader.brain!.goals = [{ kind: 'wait', targetId: null, destination: null, phase: 'act', reason: 'test base goal' }];
    w.events = [{ t: 'guardShot', site: 'bowl', from: { x: 0, y: 0 }, target: trader.id, rounds: [round(8)] }];
    noteHurt(w);
    w.events = [];
    expect(trader.brain!.hurt).toBe(8);
    const rng = w.rngState;
    expect(thinkNpc(w, trader).kind).toBe('wait');
    expect(w.rngState).toBe(rng);
  });
});

describe('decision points', () => {
  it('the same hostile in sight fires one roll', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const npc = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 10, y: 10 });
    const raider = addVehicle(w, 'raiders', 'buggy', [], { x: 14, y: 10 });
    const key = `hostileSeen:${raider.id}`;
    npc.brain!.goals = [{ kind: 'scavenge', targetId: 'salvage-yard', destination: { x: 100, y: 100 }, phase: 'travel', reason: 'search a known salvage site' }];
    // The first sighting rolls. Start from a seed on which it keeps, so later turns show only whether a roll fires.
    const keeps = (seed: number) => {
      const x = cloneWorld(w);
      x.rngState = seed;
      thinkNpc(x, find(x, npc.id));
      return topGoal(find(x, npc.id))?.kind === 'scavenge';
    };
    const seed = Array.from({ length: 100 }, (_, i) => i).find(keeps);
    if (seed === undefined) throw new Error('No seed in 100 keeps');
    w.rngState = seed;
    thinkNpc(w, npc);
    expect(w.rngState).not.toBe(seed);
    expect(npc.brain!.noticed).toHaveProperty([key]);
    expect(topGoal(npc)?.kind).toBe('scavenge');
    const rng = w.rngState;
    thinkNpc(w, npc);
    thinkNpc(w, npc);
    expect(w.rngState).toBe(rng);
    // Briefly out of sight, the raider is still remembered, so it fires no new roll.
    w.obstacles.push({ id: 'cover', kind: 'rock', pos: { x: 12, y: 10 }, r: 1 });
    w.turn += NPC_BEHAVIOR.noticeMemory;
    thinkNpc(w, npc);
    expect(npc.brain!.noticed).toHaveProperty([key]);
    // Out of sight past the memory, it is forgotten. Back in sight, it fires again.
    w.turn += 1;
    thinkNpc(w, npc);
    expect(npc.brain!.noticed).not.toHaveProperty([key]);
    w.obstacles = [];
    const hidden = w.rngState;
    thinkNpc(w, npc);
    expect(w.rngState).not.toBe(hidden);
    expect(npc.brain!.noticed).toHaveProperty([key]);
  });

  it('a subject a goal targets stays noticed while out of perception', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = w.player.vehicleId;
    const raider = addNpc(w, 'raiders', 'buggy', ['raider'], { x: 70, y: 30 });
    raider.brain!.goals = [{ kind: 'investigate', targetId: me, destination: { x: 30, y: 30 }, phase: 'travel', reason: 'heard a hostile beyond sight' }];
    raider.brain!.noticed = { [`contactHeard:${me}`]: w.turn };
    w.turn += NPC_BEHAVIOR.noticeMemory + 1;
    thinkNpc(w, raider);
    expect(raider.brain!.goals.at(-1)).toMatchObject({ kind: 'investigate', targetId: me });
    expect(raider.brain!.noticed).toHaveProperty([`contactHeard:${me}`]);
  });

  it('a raider investigates a contact, and a scavenger rarely does', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.vehicles[0].speed = 4; // loud enough to be heard past sight range
    const beyond = 30 + TERRAIN.vision.radius + 5; // just past sight
    const raider = addNpc(w, 'raiders', 'buggy', ['raider'], { x: beyond, y: 30 });
    const scav = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 60 - beyond, y: 30 }); // the other side, out of the raider's sight
    // The player is hostile to the scavenger through a feud, so both hear a hostile contact.
    addState(w, 'feud', scav.id, w.player.vehicleId, { kind: 'feud', robbery: false });
    expect(optionWeights(w, raider, 'contactHeard', w.player.vehicleId, null).investigate).toBeGreaterThan(0);
    expect(optionWeights(w, scav, 'contactHeard', w.player.vehicleId, null).investigate).toBe(0);
    let investigated = 0;
    let scavInvestigated = 0;
    for (let seed = 0; seed < 200; seed++) {
      const x = cloneWorld(w);
      x.rngState = seed;
      if (thinkNpc(x, find(x, raider.id)).kind === 'investigate') investigated++;
      if (thinkNpc(x, find(x, scav.id)).kind === 'investigate') scavInvestigated++;
    }
    expect(investigated).toBeGreaterThan(100);
    // Investigating is available to anyone, so a scavenger picks it at about MIN_CHANCE.
    expect(scavInvestigated).toBeLessThan(10);
  });

  it('fires attacked once per new shot, even a miss', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const npc = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 10, y: 10 });
    const raider = addVehicle(w, 'raiders', 'buggy', [], { x: 14, y: 10 });
    npc.brain!.noticed = { [`hostileSeen:${raider.id}`]: w.turn };
    npc.brain!.goals = [{ kind: 'wait', targetId: null, destination: null, phase: 'act', reason: 'test base goal' }];
    forceOption('attacked', 'flee');
    thinkNpc(w, npc);
    expect(npc.brain!.goals.some((g) => g.kind === 'flee')).toBe(false);
    npc.brain!.attackers = { [raider.id]: false };
    const rolls = (seed: number) => {
      const x = cloneWorld(w);
      x.rngState = seed;
      return thinkNpc(x, find(x, npc.id)).kind === 'flee' ? x : null;
    };
    const fled = Array.from({ length: 20 }, (_, i) => rolls(i)).find((x) => x !== null);
    if (!fled) throw new Error('No seed in 20 flees');
    const me = find(fled, npc.id);
    expect(me.brain!.goals.at(-1)).toMatchObject({ kind: 'flee', targetId: raider.id });
    expect(me.brain!.attackers).toEqual({ [raider.id]: true });
    const rng = fled.rngState;
    thinkNpc(fled, me);
    expect(fled.rngState).toBe(rng);
  });
});

describe('known face perk', () => {
  it('doubles the tow weight toward the stranded player', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const trader = addNpc(w, 'traders', 'trader', ['trader'], { x: 36, y: 30 });
    const me = w.player.vehicleId;
    w.player.fuel = 0;
    const base = optionWeights(w, trader, 'strandedSeen', me, null);
    w.player.perks.push('knownFace');
    const known = optionWeights(w, trader, 'strandedSeen', me, null);
    expect(known.tow).toBeCloseTo(base.tow! * PERK_NUMBERS.knownFace.tow, 9);
    expect(known.keep).toBe(base.keep);
  });
});

describe('truce answers', () => {
  const setup = (robbery: boolean) => {
    const w = emptyWorld({ x: 80, y: 80 });
    const me = w.player.vehicleId;
    const robber = addNpc(w, 'scavengers', 'scavenger', ['scavenger', 'scumbag'], { x: 14, y: 10 }, ['autocannon', 'stockEngine']);
    addState(w, 'feud', robber.id, me, { kind: 'feud', robbery });
    const accept = () => optionChances(optionWeights(w, robber, 'truceOffered', me, vehicleDanger(w, find(w, me)))).accept!;
    return { robber, accept };
  };

  it('a confident robber rarely takes a truce from its prey', () => {
    expect(setup(false).accept()).toBeGreaterThan(0.5);
    expect(setup(true).accept()).toBeLessThan(0.15);
  });

  it('a weak robber takes a truce as readily as any driver', () => {
    const { robber, accept } = setup(true);
    corePart(robber, 'cab').hp = 1;
    expect(accept()).toBeGreaterThan(0.5);
  });

  it('a confident raider rarely takes a truce from prey with loot', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const me = find(w, w.player.vehicleId);
    const raider = addNpc(w, 'raiders', 'raider', ['raider'], { x: 14, y: 10 }, ['autocannon', 'stockEngine']);
    const accept = () => optionChances(optionWeights(w, raider, 'truceOffered', me.id, vehicleDanger(w, me))).accept!;
    addGoods(w, me, 'scrap', 2);
    expect(accept()).toBeLessThan(0.1);
    corePart(raider, 'cab').hp = 1;
    expect(accept()).toBeGreaterThan(0.5);
  });
});

describe('truce offers', () => {
  it('a robber that is not weak rarely offers its prey a truce', () => {
    const truce = (robbery: boolean, cab: number | null) => {
      const w = emptyWorld({ x: 80, y: 80 });
      const me = w.player.vehicleId;
      const robber = addNpc(w, 'scavengers', 'scavenger', ['scavenger', 'scumbag'], { x: 14, y: 10 }, ['autocannon', 'stockEngine']);
      addState(w, 'feud', robber.id, me, { kind: 'feud', robbery });
      if (cab !== null) corePart(robber, 'cab').hp = cab;
      return optionWeights(w, robber, 'parley', me, vehicleDanger(w, find(w, me))).truce!;
    };
    expect(truce(true, null)).toBeLessThan(truce(false, null) / 5);
    expect(truce(true, 1)).toBe(truce(false, 1));
  });
});

describe('robbery after a truce', () => {
  it('a robber rarely robs a truck it holds a truce with', () => {
    const w = emptyWorld({ x: 10, y: 10 });
    const me = find(w, w.player.vehicleId);
    addGoods(w, me, 'scrap', 2);
    const robber = addNpc(w, 'scavengers', 'scavenger', ['scavenger', 'scumbag'], { x: 14, y: 10 }, ['autocannon', 'stockEngine']);
    refreshVision(w);
    const rob = () => optionWeights(w, robber, 'preySeen', me.id, vehicleDanger(w, me)).rob!;
    const before = rob();
    addState(w, 'truce', robber.id, me.id, { kind: 'none' });
    expect(rob()).toBeLessThan(before / 100);
  });
});

describe('hunting grounds', () => {
  const grounds = huntingGrounds();
  const lootPads = REGION.locations.filter((l) => l.kind !== 'camp' && siteLootTable(l)).flatMap((l) => sitePads(l));
  const isPad = (p: Vec) => lootPads.some((pad) => dist(p, pad) < 0.01);
  const onRoad = (p: Vec) => !isPad(p) && REGION.roads.some((road) => polylineDist(p, road) < 0.01);

  it('lie on lonely road stretches and at the pads of salvage sites', () => {
    expect(lootPads.length).toBeGreaterThan(0);
    for (const pad of lootPads) expect(grounds).toContainEqual(pad);
    expect(grounds.filter(onRoad).length).toBeGreaterThanOrEqual(5);
  });

  it('keeps road grounds far from every site, and none at a town or camp', () => {
    const sites = [...REGION.towns, ...REGION.locations];
    for (const p of grounds.filter(onRoad)) for (const site of sites) expect(dist(p, site.pos) - site.radius).toBeGreaterThanOrEqual(HUNT.siteDistance);
    const guarded = [...REGION.towns, ...REGION.locations.filter((l) => l.kind === 'camp')];
    for (const p of grounds) for (const site of guarded) expect(dist(p, site.pos)).toBeGreaterThan(site.radius + REGION.sites.pad.length);
  });
});
