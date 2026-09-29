import { describe, expect, it } from 'vitest';
import { fireSpans } from '../../sim/armor';
import { gunOf } from '../../sim/combat';
import { vehicleStats } from '../../sim/stats';
import { addVehicle, emptyWorld } from '../../sim/testkit';
import { hoverArcs, iconAngle } from './weaponRange';

function raiderWithGun() {
  const world = emptyWorld();
  const raider = addVehicle(world, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 33, y: 30 });
  return { world, raider };
}

describe('hoverArcs', () => {
  it('gives each working gun the spans the sim allows and its range', () => {
    const { world, raider } = raiderWithGun();
    const weapons = vehicleStats(world, raider).weapons;

    const arcs = hoverArcs(world, raider, weapons);

    expect(arcs).toHaveLength(weapons.length);
    expect(arcs[0].spans).toEqual(fireSpans(weapons[0].def.arc, weapons[0].sides));
    expect(arcs[0].spent).toBe(false);
  });

  it('draws no arc for a gun with no hit points', () => {
    const { world, raider } = raiderWithGun();
    const weapons = vehicleStats(world, raider).weapons;
    weapons[0].part.hp = 0;

    expect(hoverArcs(world, raider, weapons)).toEqual([]);
  });

  it('marks an empty gun spent', () => {
    const { world, raider } = raiderWithGun();
    const weapons = vehicleStats(world, raider).weapons;
    gunOf(weapons[0].part).ammo = 0;

    expect(hoverArcs(world, raider, weapons)[0].spent).toBe(true);
  });

  it('marks a cooling gun spent', () => {
    const { world, raider } = raiderWithGun();
    const weapons = vehicleStats(world, raider).weapons;
    gunOf(weapons[0].part).cooldown = 1;

    expect(hoverArcs(world, raider, weapons)[0].spent).toBe(true);
  });
});

describe('iconAngle', () => {
  it('sits inside the widest span', () => {
    const angle = iconAngle([{ from: -10, to: 10 }, { from: 60, to: 180 }], 0, 1);

    expect(angle).toBe(120);
  });

  it('spreads guns of equal arcs apart', () => {
    const spans = [{ from: -45, to: 45 }];

    expect(iconAngle(spans, 0, 2)).not.toBe(iconAngle(spans, 1, 2));
  });
});
