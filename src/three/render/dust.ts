// Dust clouds from world.dustClouds. Each cloud keeps its own sprites for its whole life, so the sky fills
// with clouds as trucks drive, and they rise, drift and fade instead of being redrawn each turn.
// Shown: clouds the player sees (world.player.clouds) and the player's own clouds in sight. Between turns a
// cloud glides toward where it will be next turn, so the drift looks continuous.
// Drawn after the fog, so a risen cloud shows over ground the player cannot see. Depth-tested, so trucks
// and hills in front hide it.

import * as THREE from 'three';
import { DETECT } from '../../data/detect';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { hash2, valueNoise } from '../../render/noise';
import { heightAt, type Terrain } from '../../sim/terrain';
import type { DustCloud, World } from '../../sim/types';

const S = PHYSICS.metersPerTile;
const RENDER_ORDER = 904; // above the fog (900) and shade (901), below contact markers
// A cloud is a loose swarm of faint puffs. The swarm spreads wide as it ages and each puff wanders on
// slow noise, so the cloud keeps changing shape. Puffs are faint on their own, so overlapping clouds
// blend into one haze instead of stacking as blobs.
const LOOK = {
  puffs: 7, // sprites per cloud
  spread: 0.5, // tiles a fresh swarm spans around its center
  spreadGrowth: 3, // extra tiles of span by the end of its life
  size: 1.8, // tiles across a fresh puff
  sizeGrowth: 2.5, // times larger by the end of its life
  opacity: 0.22, // per puff at its thickest; it fades in, then out toward the end of its life
  fadeIn: 0.5, // turns to fade in
  wobble: 0.8, // tiles each puff wanders from its place in the swarm
  wobbleSeconds: 3.5, // time scale of that wandering
  glideSeconds: 1.2, // time a cloud takes to glide to its next-turn position after a turn
};

type View = { group: THREE.Group; puffs: THREE.Sprite[] };

export class DustCloudsView {
  readonly root = new THREE.Group();
  private readonly views = new Map<string, View>();
  private readonly texture = createPuffTexture();
  private lastTurn = -1;
  private turnMs = 0;

  update(world: World, terrain: Terrain, nowMs: number): void {
    if (world.turn !== this.lastTurn) {
      this.lastTurn = world.turn;
      this.turnMs = nowMs;
    }
    const glide = Math.min(1, (nowMs - this.turnMs) / 1000 / LOOK.glideSeconds);
    const shown = new Set(world.player.clouds);
    for (const c of world.dustClouds) if (c.source === world.player.vehicleId) shown.add(c.id);
    for (const [id, view] of this.views) {
      if (shown.has(id)) continue;
      this.root.remove(view.group);
      for (const p of view.puffs) p.material.dispose();
      this.views.delete(id);
    }
    for (const c of world.dustClouds) {
      if (!shown.has(c.id)) continue;
      let view = this.views.get(c.id);
      if (!view) {
        view = this.makeView(c.id);
        this.views.set(c.id, view);
      }
      place(terrain, view, c, glide, nowMs / 1000);
    }
  }

  private makeView(id: string): View {
    const group = new THREE.Group();
    const puffs = Array.from({ length: LOOK.puffs }, () => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, color: PAL.dustTrail, transparent: true, opacity: 0, depthWrite: false }));
      sprite.renderOrder = RENDER_ORDER;
      return sprite;
    });
    group.name = id;
    group.add(...puffs);
    this.root.add(group);
    return { group, puffs };
  }
}

// age runs on smoothly between turns: whole turns from the sim, plus the glide share of the next one.
function place(terrain: Terrain, view: View, c: DustCloud, glide: number, seconds: number): void {
  const age = c.age + glide;
  const x = c.pos.x + c.vel.x * glide;
  const y = c.pos.y + c.vel.y * glide;
  const life = Math.min(1, age / DETECT.dust.lifetime);
  const fade = Math.min(1, age / LOOK.fadeIn) * (1 - life);
  view.group.position.set(x * S, (heightAt(terrain, x, y) + age * DETECT.dust.riseHeight) * S, y * S);
  const seed = hashId(view.group.name);
  const span = LOOK.spread + LOOK.spreadGrowth * life;
  const t = seconds / LOOK.wobbleSeconds;
  view.puffs.forEach((p, i) => {
    const k = seed + i * 17;
    const wx = (valueNoise(k * 0.13 + t, 1.7) - 0.5) * 2 * LOOK.wobble;
    const wz = (valueNoise(4.3, k * 0.13 + t) - 0.5) * 2 * LOOK.wobble;
    p.position.set(((hash2(k, 3) - 0.5) * span + wx) * S, hash2(k, 7) * span * 0.4 * S, ((hash2(k, 11) - 0.5) * span + wz) * S);
    // Each puff swells and thins on its own, so the outline keeps changing.
    const breathe = 0.75 + 0.5 * valueNoise(k * 0.29 + t * 1.3, 8.1);
    p.scale.setScalar(LOOK.size * (1 + (LOOK.sizeGrowth - 1) * life) * breathe * S);
    p.material.opacity = LOOK.opacity * fade * (0.6 + 0.8 * hash2(k, 13));
  });
}

function createPuffTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create dust texture');
  // A soft falloff with no bright core, so puffs read as haze rather than balls.
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.3)');
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
