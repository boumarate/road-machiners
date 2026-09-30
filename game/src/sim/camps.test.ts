import { describe, expect, it } from 'vitest';
import { SHOPS } from '../data/market';
import { NPCS, SPAWN, TRAITS } from '../data/npcs';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { planNpcOrders } from './ai';
import { serviceAtCamp } from './economy';
import { corePart, goodsCount } from './grid';
import { fireGuards } from './guards';
import { addGoods } from './inventory';
import { resolveNpcActivities, thinkNpc, topGoal } from './npc-activities';
import { getResources } from './resources';
import { canUseSite, siteGates, sitePads } from './sites';
import { spawnInitial } from './spawn';
import { addVehicle, emptyWorld, npcBrain } from './testkit';
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
  v.brain = npcBrain(templateId, pos, NPCS[templateId].traits);
  return v;
}

describe('raider camps', () => {
  it('are the raider bases, each with a road into its gate', () => {
    expect(camps.map((c) => c.id).sort()).toEqual([...TRAITS.raider.bases].sort());
    for (const camp of camps) expect(siteGates(camp).length).toBeGreaterThan(0);
  });

  it('spawn raiders just outside a camp gate', () => {
    const w = emptyWorld({ x: 300, y: 300 });
    spawnInitial(w);
    const raiders = w.vehicles.filter((v) => v.faction === 'raiders');
    expect(raiders).toHaveLength(SPAWN.initial.filter((id) => NPCS[id].faction === 'raiders').length);
    for (const r of raiders) {
      const near = camps.flatMap((c) => siteGates(c)).some((g) => dist(g, r.pos) <= SPAWN.gateSpread + 2);
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
    expect(topGoal(raider)).toMatchObject({ kind: 'resupply', targetId: 'kiln' });
    raider.pos = outside(1);
    raider.speed = 0;
    resolveNpcActivities(w);
    expect(corePart(raider, 'cab').hp).toBeGreaterThan(1);
    expect(goodsCount(raider).scrap).toBe(1);
    expect(topGoal(raider)).toBeNull();
  });

  it('send a broke raider with cargo to sell at a shop before its camp', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const raider = addNpc(w, 'raiders', 'buggy', outside(20));
    getResources(w, raider).fuel = 0;
    getResources(w, raider).money = 0;
    addGoods(w, raider, 'scrap', 1);
    planNpcOrders(w);
    expect(topGoal(raider)?.kind).toBe('sell');
    expect(Object.keys(SHOPS)).toContain(topGoal(raider)?.targetId);
  });

  it('are the only place a stranded raider is served', () => {
    const town = REGION.towns[0];
    const townPad = sitePads(town)[0];
    const strand = (pos: Vec, template: string) => {
      const w = emptyWorld({ x: 30, y: 30 });
      const v = addNpc(w, template === 'trader' ? 'traders' : 'raiders', template, pos);
      getResources(w, v).fuel = 0;
      getResources(w, v).money = 500;
      corePart(v, 'cab').hp = 1;
      return { w, v };
    };
    const atTown = strand(townPad, 'buggy');
    const items = atTown.v.items.map((it) => it.id);
    thinkNpc(atTown.w, atTown.v);
    expect(atTown.v.items.map((it) => it.id)).toEqual(items);
    expect(corePart(atTown.v, 'cab').hp).toBe(1);
    expect(getResources(atTown.w, atTown.v).fuel).toBe(0);

    const atCamp = strand(outside(1), 'buggy');
    thinkNpc(atCamp.w, atCamp.v);
    expect(getResources(atCamp.w, atCamp.v).fuel).toBeGreaterThan(0);

    const trader = strand(townPad, 'trader');
    thinkNpc(trader.w, trader.v);
    expect(getResources(trader.w, trader.v).fuel).toBeGreaterThan(0);
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
