import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { START_KITS } from '../data/start';
import { TEST_MAP } from '../test/map';
import { playerVehicle } from './damage';
import { townAt } from './sites';
import { vehicleStats } from './stats';
import { dist } from './vec';
import { newWorld, startPose, townStart } from './world';

describe('townStart', () => {
  it('parks every chassis on a town pad with no vehicle on top of it', () => {
    for (const chassis of Object.keys(CHASSIS)) {
      const kit = { ...START_KITS.standard, chassis, parts: [], cargo: {}, storage: [] };
      const world = newWorld(7, kit, TEST_MAP, true, townStart());
      const truck = playerVehicle(world);
      expect(townAt(world), chassis).not.toBeNull();
      for (const v of world.vehicles.filter((o) => o !== truck)) {
        expect(dist(v.pos, truck.pos), `${chassis} and ${v.id}`).toBeGreaterThan(vehicleStats(world, truck).radius);
      }
    }
  });

  it('leaves the default start where the new game puts it', () => {
    const world = newWorld(7, START_KITS.standard, TEST_MAP, false);
    expect(playerVehicle(world).pos).toEqual(startPose().pos);
  });
});
