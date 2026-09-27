import { NPC_BEHAVIOR } from '../data/npcs';
import { describe, expect, it } from 'vitest';
import { TERRAIN } from '../data/terrain';
import { corePart } from './grid';
import { decide, optionWeights, vehicleDanger } from './npc-decisions';
import { thinkNpc, topGoal } from './npc-activities';
import { addState } from './states';
import { addVehicle, emptyWorld, forceOption, npcBrain } from './testkit';
import type { TraitId } from '../data/npcs';
import type { Faction, Vehicle, World } from './types';
import type { Vec } from './vec';
import { cloneWorld } from './world';

function addNpc(w: World, faction: Faction, templateId: string, traits: TraitId[], pos: Vec, parts = ['mg', 'stockEngine']): Vehicle {
  const v = addVehicle(w, faction, 'scout', parts, pos);
  v.brain = npcBrain(templateId, pos, traits);
  return v;
}

const find = (w: World, id: string) => w.vehicles.find((v) => v.id === id)!;

describe('decision weights', () => {
  it('never picks a zero-weight option over 200 seeds', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const trader = addNpc(w, 'traders', 'trader', ['trader'], { x: 10, y: 10 }, ['autocannon', 'stockEngine']);
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 14, y: 10 });
    expect(optionWeights(w, trader, 'hostileSeen', raider.id, vehicleDanger(w, raider)).fight).toBe(0);
    for (let seed = 0; seed < 200; seed++) {
      w.rngState = seed;
      expect(decide(w, trader, 'hostileSeen', raider.id, vehicleDanger(w, raider))).not.toBe('fight');
    }
  });

  it('throws when every option has zero weight', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const npc = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 10, y: 10 });
    forceOption('hurt', 'flee');
    // Nothing in sight to flee from, so flee has no weight either.
    expect(optionWeights(w, npc, 'hurt', null, null).flee).toBe(0);
    expect(() => decide(w, npc, 'hurt', null, null)).toThrow(/weight/);
  });

  it('gives no fight weight without a working weapon', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const npc = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 10, y: 10 }, ['stockEngine']);
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 14, y: 10 });
    expect(optionWeights(w, npc, 'hostileSeen', raider.id, vehicleDanger(w, raider)).fight).toBe(0);
  });

  it('raises flee weight when outgunned or damaged', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const npc = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 10, y: 10 }, ['mg', 'stockEngine']);
    const weak = addVehicle(w, 'raiders', 'buggy', [], { x: 14, y: 10 });
    const strong = addVehicle(w, 'raiders', 'scout', ['autocannon'], { x: 14, y: 12 });
    const calm = optionWeights(w, npc, 'hostileSeen', weak.id, vehicleDanger(w, weak)).flee;
    expect(optionWeights(w, npc, 'hostileSeen', strong.id, vehicleDanger(w, strong)).flee).toBeGreaterThan(calm);
    corePart(npc, 'cab').hp = 1;
    expect(optionWeights(w, npc, 'hostileSeen', weak.id, vehicleDanger(w, weak)).flee).toBeGreaterThan(calm);
  });

  it('a coward flees from an equal truck more often than a plain scavenger', () => {
    const flees = (traits: TraitId[]) => {
      const w = emptyWorld({ x: 80, y: 80 });
      const npc = addNpc(w, 'scavengers', 'scavenger', traits, { x: 10, y: 10 });
      npc.brain!.goals = [{ kind: 'scavenge', targetId: 'salvage-yard', destination: { x: 100, y: 100 }, phase: 'travel', reason: 'search a known salvage site' }];
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
    const before = optionWeights(w, npc, 'hostileSeen', a.id, vehicleDanger(w, a)).fight;
    addState(w, 'feud', npc.id, a.id, { kind: 'feud', robbery: false });
    expect(optionWeights(w, npc, 'hostileSeen', a.id, vehicleDanger(w, a)).fight).toBeGreaterThan(before);
    expect(optionWeights(w, npc, 'hostileSeen', b.id, vehicleDanger(w, b)).fight).toBe(before);
  });

  it('a trader never fights', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const trader = addNpc(w, 'traders', 'trader', ['trader'], { x: 10, y: 10 }, ['autocannon', 'stockEngine']);
    addVehicle(w, 'raiders', 'buggy', [], { x: 14, y: 10 });
    for (let seed = 0; seed < 200; seed++) {
      const x = cloneWorld(w);
      x.rngState = seed;
      expect(thinkNpc(x, find(x, trader.id)).kind).not.toBe('fight');
    }
  });

  it('a spurned tower gives no tow weight toward that player', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const trader = addNpc(w, 'traders', 'trader', ['trader'], { x: 36, y: 30 });
    const me = w.player.vehicleId;
    expect(optionWeights(w, trader, 'strandedSeen', me, null).tow).toBeGreaterThan(0);
    addState(w, 'spurned', trader.id, me, { kind: 'none' });
    expect(optionWeights(w, trader, 'strandedSeen', me, null).tow).toBe(0);
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

  it('a raider investigates a contact, and a scavenger does not', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.vehicles[0].speed = 4; // loud enough to be heard past sight range
    const beyond = 30 + TERRAIN.vision.radius + 5; // just past sight
    const raider = addNpc(w, 'raiders', 'buggy', ['raider'], { x: beyond, y: 30 });
    const scav = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: beyond, y: 31 });
    // The player is hostile to the scavenger through a feud, so both hear a hostile contact.
    addState(w, 'feud', scav.id, w.player.vehicleId, { kind: 'feud', robbery: false });
    expect(optionWeights(w, raider, 'contactHeard', w.player.vehicleId, null).investigate).toBeGreaterThan(0);
    expect(optionWeights(w, scav, 'contactHeard', w.player.vehicleId, null).investigate).toBe(0);
    let investigated = 0;
    for (let seed = 0; seed < 200; seed++) {
      const x = cloneWorld(w);
      x.rngState = seed;
      if (thinkNpc(x, find(x, raider.id)).kind === 'investigate') investigated++;
      expect(thinkNpc(x, find(x, scav.id)).kind).not.toBe('investigate');
    }
    expect(investigated).toBeGreaterThan(100);
  });

  it('fires hurt while damage was taken last turn', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const npc = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 10, y: 10 });
    const raider = addVehicle(w, 'raiders', 'buggy', [], { x: 14, y: 10 });
    forceOption('hostileSeen', 'keep');
    forceOption('hurt', 'flee');
    thinkNpc(w, npc);
    expect(npc.brain!.goals.some((g) => g.kind === 'flee')).toBe(false);
    npc.brain!.hurt = 5;
    expect(thinkNpc(w, npc)).toMatchObject({ kind: 'flee', targetId: raider.id });
  });
});
