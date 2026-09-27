import { describe, expect, it } from 'vitest';
import { CONTRACTS, SHOPS } from '../data/market';
import { REGION } from '../data/region';
import { playerVehicle } from './damage';
import { makePart } from './factory';
import { goodsCount } from './grid';
import { sitePads } from './sites';
import { addVehicle, emptyWorld, npcBrain } from './testkit';
import type { Vehicle, World } from './types';
import { update } from './world';
import {
  acceptContract,
  advanceContracts,
  bountyFulfilled,
  deliverContract,
  goodValue,
  bountyLapsed,
  contractReward,
  estimateTurns,
  haulPenalty,
  initializeShops,
  isExpired,
  rollContract,
  type Contract,
} from './market';

// A raider NPC of a spawn template, as bounties name raiders by template.
function addRaider(w: World, templateId: string, pos = { x: 5, y: 5 }): Vehicle {
  const v = addVehicle(w, 'raiders', 'buggy', [], pos);
  v.brain = npcBrain(templateId, pos, ['raider']);
  return v;
}

describe('estimateTurns', () => {
  it('grows with distance', () => {
    const near = estimateTurns({ x: 0, y: 0 }, { x: 10, y: 0 });
    const far = estimateTurns({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(far).toBeGreaterThan(near);
  });
});

describe('contractReward', () => {
  it('scales with turns', () => {
    const short = contractReward('fetch', 50, 1, 0);
    const long = contractReward('fetch', 200, 1, 0);
    expect(long).toBeGreaterThan(short);
  });

  it('scales with tier at the same turns', () => {
    const tier1 = contractReward('fetch', 100, 1, 0);
    const tier3 = contractReward('fetch', 100, 3, 0);
    expect(tier3).toBeGreaterThan(tier1);
  });

  it('pays a bounty more than a haul for the same turns and tier', () => {
    const haul = contractReward('haul', 100, 2, 0);
    const bounty = contractReward('bounty', 100, 2, 0);
    expect(bounty).toBeGreaterThan(haul);
  });

  it('adds a cut of cargo value to a haul reward only', () => {
    const plain = contractReward('haul', 100, 2, 0);
    const withCargo = contractReward('haul', 100, 2, 1000);
    expect(withCargo).toBeGreaterThan(plain);
    expect(contractReward('fetch', 100, 2, 1000)).toBe(contractReward('fetch', 100, 2, 0));
  });
});

describe('rollContract', () => {
  const shop = { id: 'bowl', pos: { x: 0, y: 0 } };
  const places = [{ id: 'nose', pos: { x: 100, y: 0 } }];
  const goods = ['salt'];
  const partDefIds = ['rifle'];

  it('is deterministic for the same rng state', () => {
    const w1 = emptyWorld();
    const w2 = emptyWorld();
    w1.marketRng.rngState = 42;
    w2.marketRng.rngState = 42;
    const raider = addRaider(w1, 'buggy');
    addRaider(w2, 'buggy');
    const c1 = rollContract(w1, shop, places, goods, partDefIds, [raider]);
    const c2 = rollContract(w2, shop, places, goods, partDefIds, [w2.vehicles.find((v) => v.faction === 'raiders')!]);
    expect(c1).toEqual(c2);
  });

  it('returns null when every kind is impossible', () => {
    const w = emptyWorld();
    expect(rollContract(w, shop, [], [], [], [])).toBeNull();
  });

  it('never rolls a bounty when there are no raiders', () => {
    const w = emptyWorld();
    for (let i = 0; i < 50; i++) {
      const c = rollContract(w, shop, places, goods, partDefIds, []);
      expect(c?.kind).not.toBe('bounty');
    }
  });

  it('never rolls a haul when there are no other places', () => {
    const w = emptyWorld();
    for (let i = 0; i < 50; i++) {
      const c = rollContract(w, shop, [], goods, partDefIds, []);
      expect(c?.kind).not.toBe('haul');
    }
  });

  it('never rolls a fetch when there are no part defs', () => {
    const w = emptyWorld();
    for (let i = 0; i < 50; i++) {
      const c = rollContract(w, shop, places, goods, [], []);
      expect(c?.kind).not.toBe('fetch');
    }
  });

  it('sets a haul deadline past the current turn by the estimated travel', () => {
    const w = emptyWorld();
    w.turn = 10;
    let haul: Contract | null = null;
    for (let i = 0; i < 50 && !haul; i++) {
      const c = rollContract(w, shop, places, goods, [], []);
      if (c?.kind === 'haul') haul = c;
    }
    expect(haul).not.toBeNull();
    expect(haul!.deadline).toBeGreaterThan(w.turn);
  });
});

describe('isExpired', () => {
  it('is false at the deadline and true after it', () => {
    const w = emptyWorld();
    const c = { deadline: 20 } as Contract;
    w.turn = 20;
    expect(isExpired(w, c)).toBe(false);
    w.turn = 21;
    expect(isExpired(w, c)).toBe(true);
  });
});

describe('bountyFulfilled', () => {
  it('is true for the player\'s kill of any truck of the template', () => {
    const w = emptyWorld();
    const outrider = addRaider(w, 'buggy');
    const other = addRaider(w, 'warband');
    const c = { kind: 'bounty', template: 'buggy' } as Contract;
    const kill = (v: Vehicle, by: string) => {
      w.removed = [v];
      w.events = [{ t: 'destroyed', vehicle: v.id, by }];
      return bountyFulfilled(w, c);
    };
    expect(kill(outrider, w.player.vehicleId)).toBe(true);
    expect(kill(outrider, 'other-npc')).toBe(false);
    expect(kill(other, w.player.vehicleId)).toBe(false);
  });
});

describe('bountyLapsed', () => {
  it('is true once no truck of the template is left in the world', () => {
    const w = emptyWorld();
    const first = addRaider(w, 'buggy');
    const second = addRaider(w, 'buggy', { x: 20, y: 5 });
    const c = { kind: 'bounty', template: 'buggy' } as Contract;
    w.vehicles = w.vehicles.filter((v) => v.id !== first.id);
    expect(bountyLapsed(w, c)).toBe(false);
    w.vehicles = w.vehicles.filter((v) => v.id !== second.id);
    expect(bountyLapsed(w, c)).toBe(true);
  });
});

describe('haulPenalty', () => {
  it('owes the full value of the hauled units', () => {
    const c = { kind: 'haul', units: 5 } as Extract<Contract, { kind: 'haul' }>;
    expect(haulPenalty(c, 20)).toBe(100);
  });
});

describe('contract boards and delivery', () => {
  const bowl = REGION.towns.find((t) => t.id === 'bowl')!;
  const nose = REGION.towns.find((t) => t.id === 'nose')!;
  const haul = (to: string, units: number): Contract => ({ id: 'ct-haul', shop: 'bowl', kind: 'haul', good: 'salt', units, to, reward: 300, xp: 30, deadline: 500, tier: 1 });
  const fetch = (): Contract => ({ id: 'ct-fetch', shop: 'bowl', kind: 'fetch', defId: 'mg', reward: 200, xp: 20, deadline: 500, tier: 1 });

  function atBowlWithOffer(c: Contract): World {
    const w = emptyWorld(sitePads(bowl)[0]);
    w.shops.bowl.contracts = [c];
    return w;
  }

  it('posts contracts on every shop board at world creation', () => {
    const w = emptyWorld();
    for (const id of Object.keys(SHOPS)) expect(w.shops[id].contracts.length).toBeGreaterThan(0);
  });

  it('never posts a fetch for a part the shop has in stock', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const w = emptyWorld();
      w.marketRng.rngState = seed;
      initializeShops(w);
      for (const state of Object.values(w.shops)) {
        const stocked = new Set(state.stock.map((p) => p.defId));
        for (const c of state.contracts) if (c.kind === 'fetch') expect(stocked.has(c.defId)).toBe(false);
      }
    }
  });

  it('loads haul cargo on acceptance and pays on delivery at the destination', () => {
    let w = atBowlWithOffer(haul('nose', 3));
    w = acceptContract(w, 'ct-haul');
    expect(goodsCount(playerVehicle(w)).salt).toBe(3);
    expect(w.shops.bowl.contracts).toHaveLength(0);
    w.vehicles[0].pos = { ...sitePads(nose)[0] };
    const money = w.player.money;
    w = deliverContract(w, 'ct-haul');
    expect(w.player.money).toBe(money + 300);
    expect(goodsCount(playerVehicle(w)).salt ?? 0).toBe(0);
    expect(w.player.contracts).toHaveLength(0);
  });

  it('refuses a haul delivery away from its destination', () => {
    const w = acceptContract(atBowlWithOffer(haul('nose', 3)), 'ct-haul');
    expect(() => deliverContract(w, 'ct-haul')).toThrow(/Not parked at nose/);
  });

  it('refuses a haul that does not fit the grid and leaves the board unchanged', () => {
    const w = atBowlWithOffer(haul('nose', 999));
    expect(() => acceptContract(w, 'ct-haul')).toThrow(/free cells/);
    expect(w.shops.bowl.contracts).toHaveLength(1);
  });

  it('takes a fetch part from garage storage', () => {
    let w = acceptContract(atBowlWithOffer(fetch()), 'ct-fetch');
    w = update(w, (d) => { d.player.storage.push(makePart(d, 'mg', 3)); });
    const money = w.player.money;
    w = deliverContract(w, 'ct-fetch');
    expect(w.player.storage).toHaveLength(0);
    expect(w.player.money).toBe(money + 200);
  });

  it('refuses a fetch with no spare part of that type', () => {
    const w = acceptContract(atBowlWithOffer(fetch()), 'ct-fetch');
    expect(() => deliverContract(w, 'ct-fetch')).toThrow(/spare/);
  });

  it('holds at most the active limit', () => {
    let w = atBowlWithOffer(fetch());
    w = update(w, (d) => {
      d.player.contracts = Array.from({ length: CONTRACTS.maxActive }, (_, i) => ({ ...fetch(), id: `held${i}` }));
    });
    expect(() => acceptContract(w, 'ct-fetch')).toThrow(/already hold/);
  });

  it('charges the goods value when a haul expires', () => {
    let w = acceptContract(atBowlWithOffer(haul('nose', 3)), 'ct-haul');
    const money = w.player.money;
    w = update(w, (d) => { d.turn = 501; advanceContracts(d); });
    expect(w.player.contracts).toHaveLength(0);
    expect(w.player.money).toBe(money - haulPenalty(haul('nose', 3) as Extract<Contract, { kind: 'haul' }>, goodValue('salt')));
  });

  it('pays a bounty on the player kill and lapses when the target leaves', () => {
    const base = emptyWorld();
    const raider = addRaider(base, 'buggy', { x: 50, y: 50 });
    const bounty: Contract = { id: 'ct-b', shop: 'bowl', kind: 'bounty', template: 'buggy', targetName: raider.name, reward: 400, xp: 40, deadline: 900, tier: 2 };
    const paid = update(base, (d) => {
      d.player.contracts = [bounty];
      d.removed = [raider];
      d.events = [{ t: 'destroyed', vehicle: raider.id, by: d.player.vehicleId }];
      advanceContracts(d);
    });
    expect(paid.player.money).toBe(base.player.money + 400);
    const lapsed = update(base, (d) => {
      d.player.contracts = [bounty];
      d.vehicles = d.vehicles.filter((v) => v.id !== raider.id);
      advanceContracts(d);
    });
    expect(lapsed.player.money).toBe(base.player.money);
    expect(lapsed.player.contracts).toHaveLength(0);
  });
});
