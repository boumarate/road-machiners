import { describe, expect, it } from 'vitest';
import { SHOPS } from '../data/market';
import { REGION } from '../data/region';
import { corePart } from './grid';
import { thinkNpc } from './npc-activities';
import { tradeOffers } from './npc-decisions';
import { sitePads } from './sites';
import { addVehicle, emptyWorld, npcBrain } from './testkit';

const site = (id: string) => [...REGION.towns, ...REGION.locations].find((s) => s.id === id)!;

function traderAt(id: string) {
  const w = emptyWorld({ x: 5, y: 5 });
  const npc = addVehicle(w, 'traders', 'hauler', ['stockEngine'], sitePads(site(id))[0]);
  npc.brain = npcBrain('trader', npc.pos, ['trader']);
  npc.resources!.money = 5_000;
  return { w, npc };
}

describe('NPCs use stalls as well as towns', () => {
  it('fuels at the nearest fuel stall when fuel is its only need', () => {
    const { w, npc } = traderAt('pump-station');
    npc.resources!.fuel = 0;
    expect(thinkNpc(w, npc)).toMatchObject({ kind: 'resupply', targetId: 'pump-station' });
  });

  it('drives to a town when it also needs repairs, since stalls do not repair', () => {
    const { w, npc } = traderAt('pump-station');
    npc.resources!.fuel = 0;
    const cab = corePart(npc, 'cab');
    cab.hp = 1;
    const activity = thinkNpc(w, npc);
    expect(activity.kind).toBe('resupply');
    expect(REGION.towns.map((t) => t.id)).toContain(activity.targetId);
  });

  it('offers trade runs through stalls from many sources', () => {
    const { w, npc } = traderAt('bowl');
    const offers = tradeOffers(w, npc);
    const stalls = Object.values(SHOPS).filter((s) => s.kind === 'stall').map((s) => s.id);
    expect(offers.some((o) => stalls.includes(o.value.source) || stalls.includes(o.value.sellShop))).toBe(true);
    expect(new Set(offers.map((o) => o.value.source)).size).toBeGreaterThan(1);
  });

  it('offers nothing to a driver with no money above its upkeep reserve', () => {
    const { w, npc } = traderAt('bowl');
    npc.resources!.money = 0;
    expect(tradeOffers(w, npc)).toEqual([]);
  });
});
