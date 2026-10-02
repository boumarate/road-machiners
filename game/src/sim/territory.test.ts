import { describe, expect, it } from 'vitest';
import { GOODS } from '../data/goods';
import { REGION } from '../data/region';
import { SALVAGE, type LootTable } from '../data/salvage';
import { TERRITORIES } from '../data/territory';
import { hazardZones, isLootSpot, territoryAt, territoryEntries } from './territory';
import { dist } from './vec';

const mid = ([lo, hi]: [number, number]): number => (lo + hi) / 2;

// Expected money value of one stock from a table's midpoints. Spare parts and supplies are left out of both sides.
function tableValue(t: LootTable): number {
  const goods = Object.entries(t.goods).reduce((sum, [id, range]) => sum + mid(range) * GOODS[id].value, 0);
  return goods + mid(t.parts) * GOODS.parts.value + mid(t.fuel) * GOODS.fuelDrums.value;
}

function territoryValue(id: string): number {
  return TERRITORIES[id].spots.reduce((sum, s) => sum + s.count * tableValue(SALVAGE[s.table]), 0);
}

const fallenSun = REGION.locations.find((l) => l.id === 'fallen-sun')!;

describe('territory queries', () => {
  it('finds the territory under a point, and none outside', () => {
    expect(territoryAt(fallenSun.pos)?.id).toBe('fallen-sun');
    expect(territoryAt({ x: fallenSun.pos.x + fallenSun.radius + 1, y: fallenSun.pos.y })).toBeNull();
  });

  it('puts every entry on the edge', () => {
    const entries = territoryEntries(fallenSun as never);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(dist(e, fallenSun.pos)).toBeCloseTo(fallenSun.radius, 6);
  });

  it('reports the hazard of each territory that has one', () => {
    expect(hazardZones().map((z) => z.id)).toEqual(Object.keys(TERRITORIES).filter((id) => TERRITORIES[id].hazard));
  });

  it('knows a loot spot only inside its territory', () => {
    const spot = { id: 'x', pos: fallenSun.pos, r: 1, kind: 'landmark', look: 'shipCache', yaw: 0 } as const;
    expect(isLootSpot(spot)).toBe(true);
    expect(isLootSpot({ ...spot, pos: { x: 1, y: 1 } })).toBe(false);
    expect(isLootSpot({ ...spot, look: 'carWreck' })).toBe(false);
  });

  it('holds no more expected loot in the orchard than in the Fallen Sun', () => {
    expect(territoryValue('orchard')).toBeLessThanOrEqual(territoryValue('fallen-sun'));
  });
});
