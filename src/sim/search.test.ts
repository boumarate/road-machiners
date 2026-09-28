import { NPCS } from '../data/npcs';
import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { SALVAGE } from '../data/salvage';
import { RULES } from '../data/rules';
import { PERK_NUMBERS, SKILL_EFFECTS, XP_TO_REACH } from '../data/skills';
import { partDef } from '../data/parts';
import { beginSearch } from './search';
import { addVehicle, emptyWorld, npcBrain, testDrive } from './testkit';
import { goodsCount } from './grid';
import { canLoot, canScavenge, scavenge, takeAllLoot, takeLoot } from './locations';
import { findSpot, gridOf } from './grid';
import { endTurn, setMoveOrder } from './world';
import { advanceJobs, isBusy, startAutoRepair } from './jobs';
import { addGoods } from './inventory';
import { mountedParts } from './grid';

describe('timed scavenging search', () => {
  it('replaces a running auto patch', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = w.vehicles[0];
    me.speed = 0;
    mountedParts(me)[0].hp = 1;
    addGoods(w, me, 'parts', 5);
    startAutoRepair(w);
    expect(me.job).toEqual(expect.objectContaining({ kind: 'repair', auto: true }));
    expect(isBusy(me)).toBe(false);
    w.salvage.push({ id: 'rich', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn * 3 }, parts: [] });
    const next = scavenge(w);
    expect(next.vehicles[0].job).toEqual(expect.objectContaining({ kind: 'search' }));
    expect(next.events).toContainEqual(expect.objectContaining({ t: 'job', outcome: 'cancelled', job: expect.objectContaining({ auto: true }) }));
  });

  it('takes turns in proportion to the stock, then opens it for looting', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'rich', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn * 3 }, parts: [] });
    let next = scavenge(w);
    expect(next.vehicles[0].job).toEqual(expect.objectContaining({ kind: 'search', turnsLeft: 3, total: 3 }));
    let turns = 0;
    while (next.vehicles[0].job) {
      next = endTurn(next, testDrive);
      if (++turns > 20) throw new Error('search never finished');
    }
    expect(turns).toBe(3);
    expect(next.events).toContainEqual({ t: 'searched', stock: 'rich' });
    expect(canLoot(next)).toBe(true);
    expect(canScavenge(next)).toBe(false);
  });

  it('searches a pile in one turn, however big', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const pile = { until: w.turn + SALVAGE.pileTurns, fromPlayer: false, basis: {} };
    w.salvage.push({ id: 'pile', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn * 5 }, parts: [], pile });
    const next = endTurn(scavenge(w), testDrive);
    expect(next.vehicles[0].job).toBeNull();
    expect(next.events).toContainEqual({ t: 'searched', stock: 'pile' });
  });

  it('a move cancels the search, and the stock stays closed', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'rich', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn * 5 }, parts: [] });
    let next = endTurn(scavenge(w), testDrive);
    next = setMoveOrder(next, { kind: 'through', dest: { x: 60, y: 30 } });
    for (let t = 0; t < 5 && next.vehicles[0].job; t++) next = endTurn(next, testDrive);
    expect(next.vehicles[0].job).toBeNull();
    expect(next.player.scavenged).not.toContain('rich');
  });

  it('takes one loot item into a chosen cell, and never more than the stock holds', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.vehicles[0].items = w.vehicles[0].items.filter((item) => item.kind === 'part');
    w.salvage.push({ id: 'rich', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: 1 }, parts: [] });
    w.player.scavenged.push('rich');
    const spot = findSpot(gridOf(w.vehicles[0]), w.vehicles[0].items, { id: 'x', kind: 'good', good: 'scrap', x: 0, y: 0, rot: 0 }, null, null)!;
    const next = takeLoot(w, 'rich', { kind: 'good', good: 'scrap' }, spot);
    expect(goodsCount(next.vehicles[0]).scrap).toBe(1);
    expect(next.salvage.find((s) => s.id === 'rich')!.goods.scrap).toBe(0);
    expect(() => takeLoot(next, 'rich', { kind: 'good', good: 'scrap' }, spot)).toThrow();
  });

  it('takes three turns to install salvage and leaves the part in stock until completion', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = w.vehicles[0];
    const weapon = me.items.find((item) => item.kind === 'part' && item.part.defId === 'mg');
    if (!weapon || weapon.kind !== 'part') throw new Error('Expected weapon');
    me.items = me.items.filter((item) => item.id !== weapon.id);
    w.salvage.push({ id: 'weapon-stock', pos: { ...me.pos }, radius: 1, goods: {}, parts: [weapon.part] });
    w.player.scavenged.push('weapon-stock');
    const next = takeLoot(w, 'weapon-stock', { kind: 'part', partId: weapon.part.id }, { x: weapon.x, y: weapon.y, rot: weapon.rot });
    expect(next.vehicles[0].job).toMatchObject({ kind: 'refit', turnsLeft: 3 });
    for (let turn = 0; turn < 2; turn++) advanceJobs(next);
    expect(next.salvage.find((stock) => stock.id === 'weapon-stock')?.parts).toHaveLength(1);
    advanceJobs(next);
    expect(next.salvage.find((stock) => stock.id === 'weapon-stock')?.parts).toHaveLength(0);
    expect(next.vehicles[0].items.some((item) => item.kind === 'part' && item.part.id === weapon.part.id)).toBe(true);
  });

  it.each(['movement', 'missing part', 'missing stock'])('cancels salvage installation after %s without duplicating the part', (reason) => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = w.vehicles[0];
    const weapon = me.items.find((item) => item.kind === 'part' && item.part.defId === 'mg');
    if (!weapon || weapon.kind !== 'part') throw new Error('Expected weapon');
    me.items = me.items.filter((item) => item.id !== weapon.id);
    w.salvage.push({ id: 'weapon-stock', pos: { ...me.pos }, radius: 1, goods: {}, parts: [weapon.part] });
    w.player.scavenged.push('weapon-stock');
    const next = takeLoot(w, 'weapon-stock', { kind: 'part', partId: weapon.part.id }, { x: weapon.x, y: weapon.y, rot: weapon.rot });
    const stock = next.salvage.find((entry) => entry.id === 'weapon-stock');
    if (!stock) throw new Error('Expected stock');
    if (reason === 'movement') next.vehicles[0].speed = 5;
    if (reason === 'missing part') stock.parts = [];
    if (reason === 'missing stock') next.salvage = next.salvage.filter((entry) => entry.id !== stock.id);
    advanceJobs(next);
    expect(next.vehicles[0].job).toBeNull();
    expect(next.vehicles[0].items.some((item) => item.kind === 'part' && item.part.id === weapon.part.id)).toBe(false);
    if (reason === 'movement') expect(stock.parts).toHaveLength(1);
  });

  it('refuses loot from a stock that was never searched', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'rich', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: 2 }, parts: [] });
    expect(() => takeAllLoot(w, 'rich')).toThrow(/Search/);
  });

  it('lets an NPC scavenger finish a search job', () => {
    const w = emptyWorld({ x: 60, y: 60 });
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 10, y: 10 });
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    for (const key of Object.keys(NPCS)) w.spawnTimer[key] = Number.MAX_SAFE_INTEGER;
    const convoy = REGION.locations.find((site) => site.kind === 'convoy')!;
    npc.pos = { x: convoy.pos.x + convoy.radius + 1, y: convoy.pos.y };
    npc.heading = Math.PI;
    // Spawns with a part-full tank so the convoy's own leftover fuel can pour into it right away.
    // A spawn at a full tank cannot accept that fuel, so the stock never empties and the NPC restarts
    // a one-turn search forever until its own supplies happen to run out hundreds of turns later.
    npc.resources!.fuel = 20;
    let cur = w;
    let sawJob = false;
    let finished = false;
    // Observed completion is well under 500 turns; keep a generous cap so a stalled NPC fails fast.
    for (let t = 0; t < 800; t++) {
      cur = endTurn(cur, testDrive);
      const actor = cur.vehicles.find((v) => v.id === npc.id)!;
      if (actor.job?.kind === 'search') sawJob = true;
      if (sawJob && !actor.job) { finished = true; break; }
    }
    expect(sawJob).toBe(true);
    expect(finished).toBe(true);
  });
});

describe('machining on searches', () => {
  it('searches in fewer turns for the player at level 5', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'rich', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn * 5 }, parts: [] });
    w.player.skills.machining = XP_TO_REACH[5];
    const turns = Math.ceil(5 * (1 - 5 * SKILL_EFFECTS.machining.search));
    expect(scavenge(w).vehicles[0].job).toEqual(expect.objectContaining({ kind: 'search', turnsLeft: turns, total: turns }));
  });

  it('still takes at least one turn at level 5', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'small', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: 1 }, parts: [] });
    w.player.skills.machining = XP_TO_REACH[5];
    expect(scavenge(w).vehicles[0].job).toEqual(expect.objectContaining({ kind: 'search', turnsLeft: 1, total: 1 }));
  });

  it('leaves NPC searches at full length', () => {
    const w = emptyWorld({ x: 60, y: 60 });
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 10, y: 10 });
    w.salvage.push({ id: 'rich', pos: { x: 10, y: 10 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn * 5 }, parts: [] });
    w.player.skills.machining = XP_TO_REACH[5];
    beginSearch(w, npc, 'rich');
    expect(npc.job).toEqual(expect.objectContaining({ kind: 'search', turnsLeft: 5, total: 5 }));
  });

  it('installs salvage in fewer turns for the player at level 5', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = w.vehicles[0];
    const weapon = me.items.find((item) => item.kind === 'part' && item.part.defId === 'mg');
    if (!weapon || weapon.kind !== 'part') throw new Error('Expected weapon');
    me.items = me.items.filter((item) => item.id !== weapon.id);
    w.salvage.push({ id: 'weapon-stock', pos: { ...me.pos }, radius: 1, goods: {}, parts: [weapon.part] });
    w.player.scavenged.push('weapon-stock');
    w.player.skills.machining = XP_TO_REACH[5];
    const next = takeLoot(w, 'weapon-stock', { kind: 'part', partId: weapon.part.id }, { x: weapon.x, y: weapon.y, rot: weapon.rot });
    const turns = Math.ceil(RULES.refitTurnsPerPart * (1 - 5 * SKILL_EFFECTS.machining.refit));
    expect(next.vehicles[0].job).toMatchObject({ kind: 'refit', turnsLeft: turns, total: turns });
  });
});

describe('scrounger perk', () => {
  // The player parked on a one-turn stock of scrap, searched to the end.
  function searched(perk: boolean) {
    const w = emptyWorld({ x: 30, y: 30 });
    if (perk) w.player.perks.push('scrounger');
    w.salvage.push({ id: 'pile', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: 1 }, parts: [] });
    const next = scavenge(w);
    advanceJobs(next);
    expect(next.player.scavenged).toContain('pile');
    return next;
  }

  const stockParts = (w: ReturnType<typeof emptyWorld>) => w.salvage.find((s) => s.id === 'pile')!.goods.parts ?? 0;

  it('adds parts to a stock the player finishes searching', () => {
    expect(stockParts(searched(false))).toBe(0);
    expect(stockParts(searched(true))).toBe(PERK_NUMBERS.scrounger.parts);
  });

  it('adds nothing on a second search of the same stock', () => {
    const w = searched(true);
    const me = w.vehicles[0];
    beginSearch(w, me, 'pile');
    advanceJobs(w);
    expect(stockParts(w)).toBe(PERK_NUMBERS.scrounger.parts);
  });

  it('adds nothing to a stock an NPC searches', () => {
    const w = emptyWorld({ x: 60, y: 60 });
    w.player.perks.push('scrounger');
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 10, y: 10 });
    w.salvage.push({ id: 'pile', pos: { x: 10, y: 10 }, radius: 1, goods: { scrap: 1 }, parts: [] });
    const held = goodsCount(npc).parts ?? 0;
    beginSearch(w, npc, 'pile');
    advanceJobs(w);
    expect(goodsCount(npc).parts ?? 0).toBe(held);
  });
});

describe('careful strip perk', () => {
  // The player's machine gun, worn down to 10 HP and lying in a stock, to be mounted back in the field.
  function mountFromStock(stockId: string, perk: boolean, playerPile = false) {
    const w = emptyWorld({ x: 30, y: 30 });
    if (perk) w.player.perks.push('carefulStrip');
    const me = w.vehicles[0];
    const weapon = me.items.find((item) => item.kind === 'part' && item.part.defId === 'mg');
    if (!weapon || weapon.kind !== 'part') throw new Error('Expected weapon');
    weapon.part.hp = 10;
    me.items = me.items.filter((item) => item.id !== weapon.id);
    const pile = playerPile ? { pile: { until: w.turn + 100, fromPlayer: true, basis: {} } } : {};
    w.salvage.push({ id: stockId, pos: { ...me.pos }, radius: 1, goods: {}, parts: [weapon.part], ...pile });
    w.player.scavenged.push(stockId);
    const next = takeLoot(w, stockId, { kind: 'part', partId: weapon.part.id }, { x: weapon.x, y: weapon.y, rot: weapon.rot });
    for (let turn = 0; turn < 20 && next.vehicles[0].job; turn++) advanceJobs(next);
    const mounted = next.vehicles[0].items.find((item) => item.kind === 'part' && item.part.id === weapon.part.id);
    if (!mounted || mounted.kind !== 'part') throw new Error('Weapon was not mounted');
    return mounted.part.hp;
  }

  it('mounts a wreck part with more HP', () => {
    const max = partDef('mg').hp;
    expect(mountFromStock('wreck-raider', false)).toBe(10);
    expect(mountFromStock('wreck-raider', true)).toBe(Math.min(max, 10 + Math.round(max * PERK_NUMBERS.carefulStrip.hp)));
  });

  it('leaves a part from a site stock as it is', () => {
    expect(mountFromStock('weapon-stock', true)).toBe(10);
  });

  it('leaves a part from a pile the player dumped as it is', () => {
    expect(mountFromStock('dump-v1-5', true, true)).toBe(10);
  });
});
