import { START_KITS } from '../data/start';
import { beforeAll, expect, it } from 'vitest';
import { dist, type Vec } from '../sim/vec';
import { endTurn, newWorld, setMoveOrder } from '../sim/world';
import { buildDrive, freeDrive, initPhysics, type Drive, type TurnResult } from './drive';
import { physicsMove } from './turn';

beforeAll(async () => {
  await initPhysics();
});

function driveRoute(start: Vec, target: Vec): { maxTilt: number; remaining: number } {
  let w = newWorld(1337, START_KITS.standard);
  w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
  w.vehicles[0].pos = { ...start };
  w.player.fuel = 999;
  let drive: Drive = buildDrive(w);
  let maxTilt = 0;
  for (let i = 0; i < 14 && dist(w.vehicles[0].pos, target) > 1; i++) {
    w = setMoveOrder(w, { kind: 'stopAt', dest: target });
    let result: TurnResult | null = null;
    w = endTurn(w, physicsMove(drive, (next) => (result = next)));
    w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
    for (const frame of result!.frames[w.vehicles[0].id]) {
      const q = frame.rot;
      maxTilt = Math.max(maxTilt, Math.acos(Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z))));
    }
    freeDrive(drive);
    drive = result!.next;
  }
  freeDrive(drive);
  return { maxTilt: maxTilt * 180 / Math.PI, remaining: dist(w.vehicles[0].pos, target) };
}

it('a truck stays under 20 degrees of tilt at both canyon road crossings', () => {
  for (const [start, target] of [
    [{ x: 80, y: 25 }, { x: 94, y: 31 }],
    [{ x: 90, y: 82 }, { x: 100, y: 73 }],
  ] as [Vec, Vec][]) {
    const result = driveRoute(start, target);
    expect(result.remaining).toBeLessThan(3);
    expect(result.maxTilt).toBeLessThan(20);
  }
});

it('the Bowl crater exit leans the truck without rolling it onto its side', () => {
  const start = newWorld(1337, START_KITS.standard).vehicles[0].pos;
  const result = driveRoute(start, { x: 25, y: 73 });
  expect(result.remaining).toBeLessThan(3);
  // 45 degrees is halfway to a sideways rollover; the crater is rougher than a road crossing.
  expect(result.maxTilt).toBeLessThan(45);
});
