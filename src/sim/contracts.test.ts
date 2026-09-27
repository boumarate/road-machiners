import { describe, expect, it } from 'vitest';
import { addVehicle, emptyWorld } from './testkit';
import {
  bountyFulfilled,
  bountyLapsed,
  contractReward,
  estimateTurns,
  haulPenalty,
  isExpired,
  rollContract,
  type Contract,
} from './market';

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
    w1.rngState = 42;
    w2.rngState = 42;
    const raider = addVehicle(w1, 'raiders', 'buggy', [], { x: 5, y: 5 });
    addVehicle(w2, 'raiders', 'buggy', [], { x: 5, y: 5 });
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
  it('is true only for the player\'s kill of the target', () => {
    const c = { kind: 'bounty', target: 'raider-1' } as Contract;
    expect(bountyFulfilled([{ t: 'destroyed', vehicle: 'raider-1', by: 'player-1' }], c, 'player-1')).toBe(true);
    expect(bountyFulfilled([{ t: 'destroyed', vehicle: 'raider-1', by: 'other-npc' }], c, 'player-1')).toBe(false);
    expect(bountyFulfilled([{ t: 'destroyed', vehicle: 'raider-2', by: 'player-1' }], c, 'player-1')).toBe(false);
  });
});

describe('bountyLapsed', () => {
  it('is true once the target vehicle is gone from the world', () => {
    const w = emptyWorld();
    const raider = addVehicle(w, 'raiders', 'buggy', [], { x: 5, y: 5 });
    const c = { kind: 'bounty', target: raider.id } as Contract;
    expect(bountyLapsed(w, c)).toBe(false);
    w.vehicles = w.vehicles.filter((v) => v.id !== raider.id);
    expect(bountyLapsed(w, c)).toBe(true);
  });
});

describe('haulPenalty', () => {
  it('owes the full value of the hauled units', () => {
    const c = { kind: 'haul', units: 5 } as Extract<Contract, { kind: 'haul' }>;
    expect(haulPenalty(c, 20)).toBe(100);
  });
});
