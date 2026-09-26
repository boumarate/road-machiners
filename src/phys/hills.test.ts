import { beforeAll, expect, it } from 'vitest';
import { endTurn, newWorld, setMoveOrder } from '../sim/world';
import { buildDrive, freeDrive, initPhysics, type Drive, type TurnResult } from './drive';
import { physicsMove } from './turn';

beforeAll(async () => {
  await initPhysics();
});

// Drives the player hard across the generated map toward several points and records the worst tilt.
it('a truck driven fast over hills stays under 20 degrees of tilt', () => {
  let maxTilt = 0;
  for (const target of [{ x: 30, y: 30 }, { x: 50, y: 10 }, { x: 10, y: 50 }, { x: 45, y: 45 }]) {
    let w = newWorld(1337);
    w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
    w.player.fuel = 999;
    let d: Drive = buildDrive(w);
    for (let i = 0; i < 14; i++) {
      const me = w.vehicles[0];
      const a = Math.atan2(target.y - me.pos.y, target.x - me.pos.x);
      w = setMoveOrder(w, { kind: 'through', dest: { x: me.pos.x + Math.cos(a) * 12, y: me.pos.y + Math.sin(a) * 12 } });
      let r: TurnResult | null = null;
      w = endTurn(w, physicsMove(d, (x) => (r = x)));
      w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
      for (const f of r!.frames[w.vehicles[0].id]) {
        const q = f.rot;
        maxTilt = Math.max(maxTilt, Math.acos(Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z))));
      }
      freeDrive(d);
      d = r!.next;
    }
    freeDrive(d);
  }
  expect((maxTilt * 180) / Math.PI).toBeLessThan(20);
});
