import { PRESSURE_MAX } from '../../data/market';
import type { World } from '../types';
import { describe, expect, it } from 'vitest';
import { chassisDef } from '../../data/chassis';
import { REGION } from '../../data/region';
import { playerVehicle } from '../damage';
import { makePart } from '../factory';
import { goodsCount, mountedParts } from '../grid';
import { addGoods, removeAllGoods } from '../inventory';
import { nearestPad, nearestTown } from '../sites';
import { isStranded } from '../stats';
import { addVehicle, emptyWorld, npcBrain, startCombat } from '../testkit';
import { botOrders, raiderHuntGrounds } from './bot';

function town(id: string) {
  const found = REGION.towns.find((t) => t.id === id);
  if (!found) throw new Error(`No town ${id}`);
  return found;
}

// An empty world with the player parked on a pad of a town, its cargo gone, and both towns known.
function parkedAt(id: string) {
  const site = town(id);
  const w = emptyWorld(nearestPad(site, site.pos));
  const me = playerVehicle(w);
  removeAllGoods(me);
  me.speed = 0;
  w.player.discovered = ['bowl', 'nose'];
  return w;
}

// Salt flooded at Nose and short at Bowl, so it is the clear best haul whatever the tuned prices.
function saltGlut(w: World): World {
  w.shops.nose.pressure.salt = -PRESSURE_MAX;
  w.shops.bowl.pressure.salt = PRESSURE_MAX;
  return w;
}

describe('botOrders', () => {
  it('gives a knocked-out player no commands', () => {
    const w = parkedAt('bowl');
    w.player.state = 'knockedOut';

    const turn = botOrders(w, 'trader');

    expect(turn.world).toBe(w);
    expect(turn.events).toEqual([]);
  });

  // Nose sells salt cheap, and Bowl pays well for it.
  it('has a trader buy the most profitable good in the town it stands at', () => {
    const w = saltGlut(parkedAt('nose'));

    const turn = botOrders(w, 'trader');

    expect(Object.keys(goodsCount(playerVehicle(turn.world)))).toEqual(['salt']);
    expect(turn.world.player.money).toBeLessThan(w.player.money);
  });

  it('has a trader carry its cargo to the known town that pays more for it', () => {
    const w = parkedAt('bowl');
    addGoods(w, playerVehicle(w), 'electronics', 2);
    w.player.costBasis.electronics = 100;

    const turn = botOrders(w, 'trader');

    const order = playerVehicle(turn.world).order;
    const nose = town('nose');
    expect(order).toEqual({ kind: 'stopAt', dest: nearestPad(nose, playerVehicle(w).pos) });
  });

  it('has a scavenger with no salvage left and every site found trade instead', () => {
    const w = saltGlut(parkedAt('nose'));
    w.salvage = [];
    w.player.discovered = [...REGION.towns, ...REGION.locations].map((site) => site.id);

    const turn = botOrders(w, 'scavenger');

    expect(Object.keys(goodsCount(playerVehicle(turn.world)))).toEqual(['salt']);
  });

  it('has a scavenger with no salvage left, every site found and no load it can afford wait in the nearest town', () => {
    const w = emptyWorld({ x: 60, y: 60 });
    const me = playerVehicle(w);
    removeAllGoods(me);
    w.salvage = [];
    w.player.discovered = [...REGION.towns, ...REGION.locations].map((site) => site.id);
    w.player.money = 0;

    const turn = botOrders(w, 'scavenger');

    const home = nearestTown(w);
    expect(playerVehicle(turn.world).order).toEqual({ kind: 'stopAt', dest: nearestPad(home, me.pos) });
  });

  // A knockout strips the engine, and the stranded truck is stuck until it gets one.
  function withoutEngine(w: ReturnType<typeof parkedAt>) {
    const me = playerVehicle(w);
    me.items = me.items.filter((it) => it.kind !== 'part' || !mountedParts(me, 'engine').includes(it.part));
    return w;
  }

  it('has a scavenger beside a wreck wait to search it while in combat', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = playerVehicle(w);
    me.speed = 0;
    w.salvage.push({ id: 'wreck-beside', pos: { x: 31.5, y: 30 }, radius: 0.6, goods: { scrap: 2 }, parts: [] });
    startCombat(w, addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 36, y: 30 }), me);

    const turn = botOrders(w, 'scavenger');

    expect(playerVehicle(turn.world).job).toBeNull();
  });

  it('has a stranded truck crawl to the nearest town', () => {
    const w = withoutEngine(parkedAt('bowl'));
    const me = playerVehicle(w);
    me.pos = { x: me.pos.x + 20, y: me.pos.y - 20 };

    const turn = botOrders(w, 'trader');

    const after = playerVehicle(turn.world);
    expect(after.order).toEqual({ kind: 'stopAt', dest: nearestPad(nearestTown(w), me.pos) });
    expect(turn.world.player.beacon).toBe(true);
  });

  it('has a stranded truck without an engine buy and mount one in town', () => {
    const w = withoutEngine(parkedAt('bowl'));
    w.shops.bowl.stock.push(makePart(w, 'stockEngine', 0));
    expect(isStranded(w, playerVehicle(w))).toBe(true);

    const turn = botOrders(w, 'hunter');

    expect(mountedParts(playerVehicle(turn.world), 'engine')).toHaveLength(1);
    expect(isStranded(turn.world, playerVehicle(turn.world))).toBe(false);
  });

  it('has a broke stranded truck crawl on with its goal instead of waiting in town', () => {
    const w = withoutEngine(parkedAt('bowl'));
    w.player.money = 0;

    const turn = botOrders(w, 'hunter');

    expect(mountedParts(playerVehicle(turn.world), 'engine')).toHaveLength(0);
    expect(playerVehicle(turn.world).order?.kind).toBe('stopAt');
  });

  // A parked raider can hold the exact point of a ground, so the stop order ends a little short of it.
  it('has a fighter whose stop ended near a hunting ground go on to the next one', () => {
    const ground = raiderHuntGrounds()[1];
    const w = parkedAt('bowl');
    const me = playerVehicle(w);
    me.pos = { x: ground.x + 1.5, y: ground.y };
    me.order = null;

    const turn = botOrders(w, 'hunter');

    expect(playerVehicle(turn.world).order).toEqual({ kind: 'stopAt', dest: raiderHuntGrounds()[2] });
  });
});

describe('the hunter', () => {
  it('strips a knocked-out truck it is parked beside', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    playerVehicle(w).speed = 0;
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 33, y: 30 });
    raider.defeat = { phase: 'out', turns: 0, unseen: 0, foes: [], gaveUp: false };

    const turn = botOrders(w, 'hunter');

    const job = playerVehicle(turn.world).job;
    expect(job?.kind).toBe('refit');
  });

  it('drives beside a knocked-out truck it sees that still has loot', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    playerVehicle(w).speed = 0;
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    raider.defeat = { phase: 'out', turns: 0, unseen: 0, foes: [], gaveUp: false };

    const turn = botOrders(w, 'hunter');

    const order = playerVehicle(turn.world).order;
    if (order?.kind !== 'stopAt') throw new Error('Expected a stop order');
    expect(Math.hypot(order.dest.x - raider.pos.x, order.dest.y - raider.pos.y)).toBeLessThan(6);
  });

  it('drives at the weaker of two raiders in sight', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    playerVehicle(w).speed = 0;
    const strong = addVehicle(w, 'raiders', 'buggy', ['mg', 'mg', 'stockEngine'], { x: 30, y: 42 });
    const weak = addVehicle(w, 'raiders', 'buggy', ['stockEngine'], { x: 42, y: 30 });
    for (const raider of [strong, weak]) raider.brain = npcBrain('buggy', raider.pos, ['raider']);

    const turn = botOrders(w, 'hunter');

    expect(playerVehicle(turn.world).order).toEqual({ kind: 'stopAt', dest: weak.pos });
  });

  it('leaves the world random stream where it was', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    playerVehicle(w).speed = 0;
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    const state = w.rngState;

    const turn = botOrders(w, 'hunter');

    expect(turn.world.rngState).toBe(state);
  });
});

describe('the markov bot', () => {
  it('needs a stretch length', () => {
    expect(() => botOrders(parkedAt('bowl'), 'markov')).toThrow(/markovTurns/);
  });

  it('plays a goal without shifting the world random stream', () => {
    const w = saltGlut(parkedAt('nose'));
    const state = w.rngState;

    const turn = botOrders(w, 'markov', { markovTurns: 10 });

    expect(turn.world.rngState).toBe(state);
  });

  it('draws the same goal for the same seed and stretch', () => {
    const a = botOrders(saltGlut(parkedAt('nose')), 'markov', { markovTurns: 10 });
    const b = botOrders(saltGlut(parkedAt('nose')), 'markov', { markovTurns: 10 });

    expect(b.world.player.money).toBe(a.world.player.money);
    expect(playerVehicle(b.world).order).toEqual(playerVehicle(a.world).order);
  });
});

describe('the fast trader', () => {
  it('buys a faster chassis and no armor with money to spare', () => {
    const w = parkedAt('bowl');
    w.player.money = 200_000;
    const before = playerVehicle(w);
    const armor = mountedParts(before, 'armor').length;

    const turn = botOrders(w, 'fastTrader');

    const after = playerVehicle(turn.world);
    expect(chassisDef(after.chassisId).maxSpeed).toBeGreaterThan(chassisDef(before.chassisId).maxSpeed);
    expect(mountedParts(after, 'armor').length).toBeLessThanOrEqual(armor);
  });
});
