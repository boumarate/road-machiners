// Smoke clouds from world.smoke: black puffs that fill each cloud's circle, with a dark ring on the ground at its edge.
// A cloud does not drift, so the ring is exactly where shots through it start to scatter. Shown: clouds the player
// sees any part of, and the player's own. Render only: it reads world.smoke and never changes it.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { hash2, valueNoise } from '../../render/noise';
import { heightAt, type Terrain } from '../../sim/terrain';
import type { SmokeCloud, World } from '../../sim/types';
import type { Vec } from '../../sim/vec';
import { playerSees } from '../../sim/vision';
import { GroundBand } from './zones';

const S = PHYSICS.metersPerTile;
const RENDER_ORDER = 905; // above the fog (900) and dust (904), below contact markers
const LOOK = {
  puffsPerArea: 0.6, // sprites per square tile of cloud, on top of basePuffs
  basePuffs: 6,
  fill: 0.8, // share of the radius the puff centers spread over, so puffs end near the edge
  size: 2.4, // tiles across a puff
  height: 1.8, // tiles the puffs rise to
  opacity: 0.5, // per puff
  lastTurn: 0.55, // opacity share in the cloud's last turn, so a thinning cloud reads as ending
  fadeInMs: 900,
  wobble: 0.35, // tiles each puff wanders
  wobbleSeconds: 5,
  edge: { width: 0.12, opacity: 0.55 }, // the ground ring at the radius, in tiles
};
const RIM_SAMPLES = 8; // rim points checked for sight, besides the center

type View = { group: THREE.Group; puffs: THREE.Sprite[]; edge: GroundBand; bornMs: number };

export class SmokeCloudsView {
  readonly root = new THREE.Group();
  private readonly views = new Map<string, View>();
  private readonly texture = createSmokeTexture();

  update(world: World, terrain: Terrain, nowMs: number): void {
    const shown = new Map(world.smoke.filter((c) => isShown(world, c)).map((c) => [c.id, c]));
    for (const [id, view] of this.views) {
      if (shown.has(id)) continue;
      this.root.remove(view.group, view.edge.mesh);
      for (const p of view.puffs) p.material.dispose();
      view.edge.dispose();
      this.views.delete(id);
    }
    for (const c of shown.values()) {
      const view = this.views.get(c.id) ?? this.makeView(c, nowMs);
      place(terrain, view, c, nowMs);
    }
  }

  private makeView(c: SmokeCloud, nowMs: number): View {
    const group = new THREE.Group();
    const count = Math.round(LOOK.basePuffs + LOOK.puffsPerArea * c.r * c.r);
    const puffs = Array.from({ length: count }, () => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, color: PAL.smoke, transparent: true, opacity: 0, depthWrite: false }));
      sprite.renderOrder = RENDER_ORDER;
      return sprite;
    });
    group.add(...puffs);
    const edge = new GroundBand({ color: PAL.smoke, opacity: LOOK.edge.opacity, renderOrder: RENDER_ORDER - 1, overTrucks: false });
    this.root.add(group, edge.mesh);
    const view = { group, puffs, edge, bornMs: nowMs };
    this.views.set(c.id, view);
    return view;
  }
}

// The player sees a cloud when it sees its center or a point of its rim. The player's own cloud always shows.
function isShown(world: World, c: SmokeCloud): boolean {
  if (c.source === world.player.vehicleId) return true;
  const rim: Vec[] = Array.from({ length: RIM_SAMPLES }, (_, i) => {
    const a = (2 * Math.PI * i) / RIM_SAMPLES;
    return { x: c.pos.x + Math.cos(a) * c.r, y: c.pos.y + Math.sin(a) * c.r };
  });
  return [c.pos, ...rim].some((p) => p.x >= 0 && p.y >= 0 && p.x < world.size && p.y < world.size && playerSees(world, p));
}

function place(terrain: Terrain, view: View, c: SmokeCloud, nowMs: number): void {
  view.edge.set(terrain, c.pos, c.r - LOOK.edge.width, c.r);
  view.group.position.set(c.pos.x * S, heightAt(terrain, c.pos.x, c.pos.y) * S, c.pos.y * S);
  const fade = Math.min(1, (nowMs - view.bornMs) / LOOK.fadeInMs) * (c.turnsLeft <= 1 ? LOOK.lastTurn : 1);
  view.edge.mesh.material.opacity = LOOK.edge.opacity * fade;
  const seed = hashId(c.id);
  const t = nowMs / 1000 / LOOK.wobbleSeconds;
  view.puffs.forEach((p, i) => {
    const k = seed + i * 17;
    // Square root spreads the puffs evenly over the disk instead of crowding the center.
    const r = Math.sqrt(hash2(k, 3)) * c.r * LOOK.fill;
    const a = hash2(k, 5) * 2 * Math.PI;
    const wx = (valueNoise(k * 0.11 + t, 2.3) - 0.5) * 2 * LOOK.wobble;
    const wz = (valueNoise(5.1, k * 0.11 + t) - 0.5) * 2 * LOOK.wobble;
    p.position.set((Math.cos(a) * r + wx) * S, (0.3 + hash2(k, 7)) * LOOK.height * 0.7 * S, (Math.sin(a) * r + wz) * S);
    p.scale.setScalar(LOOK.size * (0.8 + 0.5 * hash2(k, 11)) * S);
    p.material.opacity = LOOK.opacity * fade * (0.7 + 0.6 * hash2(k, 13));
  });
}

function createSmokeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create smoke texture');
  // A fuller core than dust, so the smoke reads as a thick screen.
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}
