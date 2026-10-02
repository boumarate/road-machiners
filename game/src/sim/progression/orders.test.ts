import { describe, expect, it } from 'vitest';
import { REGION } from '../../data/region';
import { startKit } from '../../data/start';
import { playerVehicle } from '../damage';
import { makePart } from '../factory';
import { mountedParts } from '../grid';
import { shopState } from '../market';
import { nearestPad } from '../sites';
import { emptyWorld } from '../testkit';
import type { World } from '../types';
import { Orders, upgradeGear, type UpgradeStyle } from './orders';

const STYLE: UpgradeStyle = { skip: [], chassis: 'value' };
const capital = startKit('standard').money;

// The player parked on a pad of Bowl, which has a garage, with plenty of money.
function atBowl(): World {
  const bowl = REGION.towns.find((t) => t.id === 'bowl');
  if (!bowl) throw new Error('No town bowl');
  const w = emptyWorld(nearestPad(bowl, bowl.pos));
  playerVehicle(w).speed = 0;
  w.player.money = capital + 100_000;
  return w;
}

const engineIds = (w: World) => mountedParts(playerVehicle(w), 'engine').map((p) => p.defId);

describe('upgradeGear', () => {
  it('replaces the mounted engine with a better one from the shop stock', () => {
    const w = atBowl();
    shopState(w, 'bowl').stock.push(makePart(w, 'turbine', 0));
    const o = new Orders(w);

    upgradeGear(o, STYLE);

    expect(engineIds(o.world)).toEqual(['turbine']);
  });

  it('spends no money that belongs to the trade capital', () => {
    const w = atBowl();
    w.player.money = capital;
    shopState(w, 'bowl').stock.push(makePart(w, 'turbine', 0));
    const o = new Orders(w);

    upgradeGear(o, STYLE);

    expect(engineIds(o.world)).toEqual(engineIds(w));
    expect(o.world.player.money).toBe(capital);
  });

  it('mounts a better part from garage storage instead of buying one', () => {
    const w = atBowl();
    shopState(w, 'bowl').stock = [];
    const spare = makePart(w, 'tunedEngine', 0);
    w.player.storage.push(spare);
    const o = new Orders(w);

    upgradeGear(o, { skip: ['weapon', 'armor', 'cargo', 'store'], chassis: 'value' });

    expect(mountedParts(playerVehicle(o.world), 'engine').map((p) => p.id)).toEqual([spare.id]);
  });

  it('never buys a kind its style skips', () => {
    const w = atBowl();
    shopState(w, 'bowl').stock.push(makePart(w, 'turbine', 0));
    const o = new Orders(w);

    upgradeGear(o, { skip: ['engine'], chassis: 'value' });

    expect(engineIds(o.world)).toEqual(engineIds(w));
  });

  it('buys nothing away from a garage', () => {
    const w = atBowl();
    playerVehicle(w).pos = { x: 5, y: 5 };
    shopState(w, 'bowl').stock.push(makePart(w, 'turbine', 0));
    const o = new Orders(w);

    upgradeGear(o, STYLE);

    expect(o.world.player.money).toBe(w.player.money);
  });
});
