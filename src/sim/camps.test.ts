import { describe, expect, it } from 'vitest';
import { NPC_CLASSES, SPAWN } from '../data/npcs';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { planNpcOrders } from './ai';
import { serviceAtCamp } from './economy';
import { corePart, goodsCount } from './grid';
import { fireGuards } from './guards';
import { addGoods } from './inventory';
import { resolveNpcActivities } from './npc-activities';
import { getResources } from './resources';
import { canUseSite, siteGates } from './sites';
import { spawnInitial } from './spawn';
import { addVehicle, emptyWorld } from './testkit';
import type { Faction, World } from './types';
import { dist, type Vec } from './vec';

const camps = REGION.locations.filter((l) => l.kind === 'camp');
const kiln = camps.find((c) => c.id === 'kiln')!;
const gate = siteGates(kiln)[0];
// A point `d` tiles out from the gate, away from the camp.
function outside(d: number): Vec {
  return { x: gate.x + ((gate.x - kiln.pos.x) / kiln.radius) * d, y: gate.y + ((gate.y - kiln.pos.y) / kiln.radius) * d };
}

function addNpc(w: World, faction: Faction, templateId: string, pos: Vec) {
  const v = addVehicle(w, faction, 'buggy', ['mg', 'stockEngine'], pos);
  v.brain = { templateId, activity: null, goal: null, home: { ...pos }, stepIndex: 0 };
  return v;
}

describe('raider camps', () => {
  it('are the raider bases, each with a road into its gate', () => {
    expect(camps.map((c) => c.id).sort()).toEqual([...NPC_CLASSES.raider.bases].sort());
    for (const camp of camps) expect(siteGates(camp).length).toBeGreaterThan(0);
  });

  it('spawn raiders just outside a camp gate', () => {
    const w = emptyWorld({ x: 300, y: 300 });
    spawnInitial(w);
    const raiders = w.vehicles.filter((v) => v.faction === 'raiders');
    expect(raiders).toHaveLength(3);
    for (const r of raiders) {
      const near = camps.flatMap((c) => siteGates(c)).some((g) => dist(g, r.pos) <= SPAWN.campSpread + 2);
      expect(near, `raider at ${r.pos.x},${r.pos.y}`).toBe(true);
    }
  });

  it('shoot an outsider near the gate who has not fired, and leave raiders alone', () => {
    const w = emptyWorld(outside(3));
    addVehicle(w, 'raiders', 'buggy', ['mg'], outside(1));
    fireGuards(w);
    const shots = w.events.filter((e) => e.t === 'guardShot');
    expect(shots.map((e) => e.t === 'guardShot' && e.target)).toEqual([w.player.vehicleId]);
    const far = emptyWorld(outside(RULES.guards.range + 2));
    fireGuards(far);
    expect(far.events.some((e) => e.t === 'guardShot')).toBe(false);
  });

  it('send a damaged raider to the nearest camp, and repair it there without selling its cargo', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const raider = addNpc(w, 'raiders', 'buggy', outside(20));
    corePart(raider, 'cab').hp = 1;
    addGoods(w, raider, 'scrap', 1);
    planNpcOrders(w);
    expect(raider.brain!.activity).toMatchObject({ kind: 'resupply', targetId: 'kiln' });
    raider.pos = outside(1);
    raider.speed = 0;
    resolveNpcActivities(w);
    expect(corePart(raider, 'cab').hp).toBeGreaterThan(1);
    expect(goodsCount(raider).scrap).toBe(1);
    expect(raider.brain!.activity).toBeNull();
  });

  it('send a broke raider with cargo to sell in town before its camp', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const raider = addNpc(w, 'raiders', 'buggy', outside(20));
    getResources(w, raider).fuel = 0;
    getResources(w, raider).money = 0;
    addGoods(w, raider, 'scrap', 1);
    planNpcOrders(w);
    expect(raider.brain!.activity?.kind).toBe('sell');
    expect(NPC_CLASSES.raider.towns).toContain(raider.brain!.activity?.targetId);
  });

  it('serve only raiders at a gate', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const trader = addNpc(w, 'traders', 'trader', outside(1));
    expect(canUseSite(trader.pos, kiln)).toBe(true);
    expect(() => serviceAtCamp(w, trader, 'kiln')).toThrow('Only raiders');
    const raider = addNpc(w, 'raiders', 'buggy', outside(1));
    expect(() => serviceAtCamp(w, raider, 'bowl')).toThrow('Not at a gate');
  });
});
