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
import { hash2 } from '../../render/noise';
import { heightAt, type Terrain } from '../../sim/terrain';
import type { DustCloud, World } from '../../sim/types';

const S = PHYSICS.metersPerTile;
const RENDER_ORDER = 904; // above the fog (900) and shade (901), below contact markers
const LOOK = {
  puffs: 3, // sprites per cloud
  spread: 0.6, // tiles the puffs of one cloud sit apart
  size: 1.6, // tiles across a fresh puff; it doubles by the end of its life
  opacity: 0.55, // at its thickest; it fades in, then out toward the end of its life
  fadeIn: 0.5, // turns to fade in
  glideSeconds: 2.5, // time a cloud takes to glide to its next-turn position after a turn
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
      place(terrain, view, c, glide);
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
function place(terrain: Terrain, view: View, c: DustCloud, glide: number): void {
  const age = c.age + glide;
  const x = c.pos.x + c.vel.x * glide;
  const y = c.pos.y + c.vel.y * glide;
  const life = age / DETECT.dust.lifetime;
  const opacity = LOOK.opacity * Math.min(1, age / LOOK.fadeIn) * Math.max(0, 1 - life);
  view.group.position.set(x * S, (heightAt(terrain, x, y) + age * DETECT.dust.riseHeight) * S, y * S);
  const seed = hashId(view.group.name);
  view.puffs.forEach((p, i) => {
    p.position.set((hash2(seed + i, 3) - 0.5) * LOOK.spread * S * (1 + life), hash2(seed + i, 7) * LOOK.spread * S, (hash2(seed + i, 11) - 0.5) * LOOK.spread * S * (1 + life));
    p.scale.setScalar(LOOK.size * S * (1 + life));
    p.material.opacity = opacity;
  });
}

function createPuffTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create dust texture');
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.8)');
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
