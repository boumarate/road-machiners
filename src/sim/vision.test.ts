import { START_KITS } from '../data/start';
import { describe, expect, it } from 'vitest';
import { TERRAIN } from '../data/terrain';
import { emptyWorld } from './testkit';
import { TIME } from '../data/time';
import { sunAt } from './sun';
import { canVehicleSee, grayRadius, playerVisible, refreshVision, sightRadius, visibleTiles } from './vision';

describe('vision', () => {
  it('sees an unblocked tile within radius', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const vis = visibleTiles(w, { x: 30, y: 30 });
    expect(vis.has(31 * w.size + 34)).toBe(true); // tile (34, 31), close and clear
  });

  it('is blocked by an obstacle between the viewer and the tile', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.obstacles = [{ id: 'r', pos: { x: 33, y: 30 }, r: 1.2, kind: 'rock' }];
    const from = { x: 30, y: 30 };
    const near = visibleTiles(w, from);
    expect(near.has(30 * w.size + 31)).toBe(true); // in front of the rock, still visible
    expect(near.has(30 * w.size + 36)).toBe(false); // behind the rock, blocked
  });

  it('sees behind a rock within the close radius', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.obstacles = [{ id: 'r', pos: { x: 31.2, y: 30.5 }, r: 0.6, kind: 'rock' }];
    const vis = visibleTiles(w, { x: 30, y: 30.5 });
    expect(vis.has(30 * w.size + 32)).toBe(true); // 2.5 tiles away, behind the rock
    expect(vis.has(30 * w.size + 35)).toBe(false); // 5.5 tiles away, behind the rock
  });

  it('lets an NPC see a vehicle behind a rock within the close radius', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.obstacles = [{ id: 'r', pos: { x: 31.2, y: 30 }, r: 0.6, kind: 'rock' }];
    const npc = { ...w.vehicles[0], id: 'npc', pos: { x: 30, y: 30 } };
    expect(canVehicleSee(w, npc, { x: 32.5, y: 30 })).toBe(true);
    expect(canVehicleSee(w, npc, { x: 35.5, y: 30 })).toBe(false);
  });

  it('does not block sight past water', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.obstacles = [{ id: 'pond', pos: { x: 33, y: 30 }, r: 1.2, kind: 'water' }];
    const vis = visibleTiles(w, { x: 30, y: 30 });
    expect(vis.has(30 * w.size + 36)).toBe(true);
  });

  it('respects the vision radius', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const vis = visibleTiles(w, { x: 30, y: 30 });
    const far = 30 + TERRAIN.vision.radius + 3;
    expect(vis.has(30 * w.size + far)).toBe(false);
  });

  it('keeps explored tiles marked after the player drives away', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    refreshVision(w);
    const idx = 30 * w.size + 30;
    expect(w.player.explored[idx]).toBe(1);
    w.vehicles.find((v) => v.id === w.player.vehicleId)!.pos = { x: 55, y: 55 };
    refreshVision(w);
    expect(playerVisible(w).has(idx)).toBe(false);
    expect(w.player.explored[idx]).toBe(1); // stays explored even though no longer visible
  });
});

describe('terrain line of sight', () => {
  it('a hill between viewer and tile blocks sight', async () => {
    const { heightAt } = await import('./terrain');
    const { newWorld } = await import('./world');
    const w = emptyWorld({ x: 30, y: 30 });
    w.terrain = newWorld(1, START_KITS.standard).terrain;
    const elevationAt = (_seed: number, x: number, y: number) => heightAt(w.terrain, x, y);
    let found: { a: { x: number; y: number }; b: { x: number; y: number } } | null = null;
    for (let x = 6; x < 54 && !found; x++) {
      for (let y = 2; y < 58 && !found; y++) {
        const peak = elevationAt(w.seed, x, y);
        const a = { x: x - 4, y }, b = { x: x + 4, y };
        if (peak - Math.max(elevationAt(w.seed, a.x, a.y), elevationAt(w.seed, b.x, b.y)) > 0.2) found = { a, b };
      }
    }
    expect(found, 'no hill found for this seed').not.toBeNull();
    w.obstacles = [];
    const vis = visibleTiles(w, found!.a);
    expect(vis.has(Math.floor(found!.b.y) * w.size + Math.floor(found!.b.x))).toBe(false);
  });

  it('reaches gray vision a fixed number of sight radii out', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.turn = Array.from({ length: TIME.turnsPerDay }, (_, i) => i + 1).find((t) => sunAt(t))!;
    expect(grayRadius(w, { x: 30, y: 30 })).toBe(TERRAIN.vision.radius * TERRAIN.vision.grayFactor);
  });

  it('shrinks gray vision at night with sight', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.turn = Array.from({ length: TIME.turnsPerDay }, (_, i) => i + 1).find((t) => !sunAt(t))!;
    expect(grayRadius(w, { x: 30, y: 30 })).toBe(sightRadius(w, { x: 30, y: 30 }) * TERRAIN.vision.grayFactor);
    expect(grayRadius(w, { x: 30, y: 30 })).toBeLessThan(TERRAIN.vision.radius * TERRAIN.vision.grayFactor);
  });
});
