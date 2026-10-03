// The views of the utility effects that lie in the world: smoke clouds, ground fields, flares, harpoon lines and
// emitter pulses. HazardViews owns them and updates them each frame. Render only: they read the world and never change it.
//
// Smoke clouds from world.smoke: black puffs that fill each cloud's circle, with a dark ring on the ground at its edge.
// A cloud does not drift, so the ring is exactly where shots through it start to scatter.
//
// Ground fields from world.fields: a caltrop field draws as steel spikes scattered over its circle, an oil patch as a
// dark decal on the ground. Each has a ring at its edge, so the edge reads where wheels start to suffer.
//
// Shown: clouds and fields the player sees any part of, and the player's own.
//
// Flares from world.flares: a red glow hanging over its point, a red point light on the ground below and a ring at the
// edge of its light, drawn while it burns within FLARE.seenRange of the player. A flare in the sky clears the hills.
// The truck its launch or its light shows is marked by contacts.ts from the player's contacts.
//
// Emitter pulses from the turn's pulse events: a ring that sweeps out over the ground to the pulse's radius and
// fades, where the player sees the user, a truck it hit or the player is involved. Trucks with shut-down turns ahead
// crackle with sparks while they are drawn.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { FLARE } from '../../data/utilities';
import { PAL } from '../../render/palette';
import { hash2, valueNoise } from '../../render/noise';
import { heightAt, type Terrain } from '../../sim/terrain';
import type { Flare, GameEvent, GroundField, SmokeCloud, World } from '../../sim/types';
import { dist, type Vec } from '../../sim/vec';
import { playerVehicle } from '../../sim/damage';
import { playerSees } from '../../sim/vision';
import { pulseEffect, shutDownTurnsLeft } from '../../sim/utility';
import { HarpoonLinesView } from './lines';
import type { VehicleView } from './vehicle';
import { GroundBand } from './zones';

const S = PHYSICS.metersPerTile;

// Every utility effect view, under one root.
export class HazardViews {
  private readonly smoke = new SmokeCloudsView();
  private readonly fields = new GroundFieldsView();
  private readonly flares = new FlaresView();
  private readonly lines = new HarpoonLinesView();
  private readonly pulses = new PulseView();
  readonly root = new THREE.Group();

  constructor() {
    this.root.add(this.smoke.root, this.fields.root, this.flares.root, this.lines.root, this.pulses.root);
  }

  // views: the vehicle views by vehicle id, which the harpoon lines run between and shut-down trucks spark on.
  update(world: World, terrain: Terrain, views: ReadonlyMap<string, VehicleView>, nowMs: number): void {
    this.smoke.update(world, terrain, nowMs);
    this.fields.update(world, terrain);
    this.flares.update(world, terrain, nowMs);
    this.lines.update(world, views);
    this.pulses.update(world, terrain, views, nowMs);
  }
}

// ---- Smoke clouds

const SMOKE_ORDER = 905; // above the fog (900) and dust (904), below contact markers
const SMOKE_LOOK = {
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

type CloudView = { group: THREE.Group; puffs: THREE.Sprite[]; edge: GroundBand; bornMs: number };

class SmokeCloudsView {
  readonly root = new THREE.Group();
  private readonly views = new Map<string, CloudView>();
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

  private makeView(c: SmokeCloud, nowMs: number): CloudView {
    const group = new THREE.Group();
    const count = Math.round(SMOKE_LOOK.basePuffs + SMOKE_LOOK.puffsPerArea * c.r * c.r);
    const puffs = Array.from({ length: count }, () => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, color: PAL.smoke, transparent: true, opacity: 0, depthWrite: false }));
      sprite.renderOrder = SMOKE_ORDER;
      return sprite;
    });
    group.add(...puffs);
    const edge = new GroundBand({ color: PAL.smoke, opacity: SMOKE_LOOK.edge.opacity, renderOrder: SMOKE_ORDER - 1, overTrucks: false });
    this.root.add(group, edge.mesh);
    const view = { group, puffs, edge, bornMs: nowMs };
    this.views.set(c.id, view);
    return view;
  }
}

// The player sees an area hazard when it sees its center or a point of its rim. The player's own always shows.
function isShown(world: World, c: { source: string; pos: Vec; r: number }): boolean {
  if (c.source === world.player.vehicleId) return true;
  const rim: Vec[] = Array.from({ length: RIM_SAMPLES }, (_, i) => {
    const a = (2 * Math.PI * i) / RIM_SAMPLES;
    return { x: c.pos.x + Math.cos(a) * c.r, y: c.pos.y + Math.sin(a) * c.r };
  });
  return [c.pos, ...rim].some((p) => p.x >= 0 && p.y >= 0 && p.x < world.size && p.y < world.size && playerSees(world, p));
}

function place(terrain: Terrain, view: CloudView, c: SmokeCloud, nowMs: number): void {
  view.edge.set(terrain, c.pos, c.r - SMOKE_LOOK.edge.width, c.r);
  view.group.position.set(c.pos.x * S, heightAt(terrain, c.pos.x, c.pos.y) * S, c.pos.y * S);
  const fade = Math.min(1, (nowMs - view.bornMs) / SMOKE_LOOK.fadeInMs) * (c.turnsLeft <= 1 ? SMOKE_LOOK.lastTurn : 1);
  view.edge.mesh.material.opacity = SMOKE_LOOK.edge.opacity * fade;
  const seed = hashId(c.id);
  const t = nowMs / 1000 / SMOKE_LOOK.wobbleSeconds;
  view.puffs.forEach((p, i) => {
    const k = seed + i * 17;
    // Square root spreads the puffs evenly over the disk instead of crowding the center.
    const r = Math.sqrt(hash2(k, 3)) * c.r * SMOKE_LOOK.fill;
    const a = hash2(k, 5) * 2 * Math.PI;
    const wx = (valueNoise(k * 0.11 + t, 2.3) - 0.5) * 2 * SMOKE_LOOK.wobble;
    const wz = (valueNoise(5.1, k * 0.11 + t) - 0.5) * 2 * SMOKE_LOOK.wobble;
    p.position.set((Math.cos(a) * r + wx) * S, (0.3 + hash2(k, 7)) * SMOKE_LOOK.height * 0.7 * S, (Math.sin(a) * r + wz) * S);
    p.scale.setScalar(SMOKE_LOOK.size * (0.8 + 0.5 * hash2(k, 11)) * S);
    p.material.opacity = SMOKE_LOOK.opacity * fade * (0.7 + 0.6 * hash2(k, 13));
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

// A stable seed from an id, so a hazard's scatter keeps its look from frame to frame.
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// ---- Ground fields

const FIELD_ORDER = 903; // above the fog (900), below dust (904) and smoke (905)
const FIELD_LOOK = {
  spikesPerArea: 4, // spikes per square tile of field, on top of baseSpikes
  baseSpikes: 6,
  spike: { radius: 0.07, height: 0.14 }, // tiles
  sheen: 0.62, // opacity of the oil decal, so the ground shows through and it reads as a slick, not a pit
  gloss: { r: 0.32, shift: 0.3, opacity: 0.28 }, // an off-centre sheen spot on the slick, sized and shifted in shares of its radius
  edge: { width: 0.1, opacity: 0.8 }, // the ring at the radius, in tiles
};

type FieldView = { spikes: THREE.Group | null; fill: GroundBand[]; edge: GroundBand };

class GroundFieldsView {
  readonly root = new THREE.Group();
  private readonly views = new Map<string, FieldView>();
  private readonly spikeGeometry = new THREE.ConeGeometry(FIELD_LOOK.spike.radius * S, FIELD_LOOK.spike.height * S, 4);
  private readonly spikeMaterial = new THREE.MeshLambertMaterial({ color: PAL.caltrops.spike, flatShading: true });

  update(world: World, terrain: Terrain): void {
    const shown = new Map(world.fields.filter((f) => isShown(world, f)).map((f) => [f.id, f]));
    for (const [id, view] of this.views) if (!shown.has(id)) this.drop(id, view);
    for (const f of shown.values()) if (!this.views.has(f.id)) this.views.set(f.id, this.makeView(terrain, f));
  }

  private drop(id: string, view: FieldView): void {
    for (const band of [...view.fill, view.edge]) {
      this.root.remove(band.mesh);
      band.dispose();
    }
    if (view.spikes) this.root.remove(view.spikes);
    this.views.delete(id);
  }

  // A field sits still, so its look is built once.
  private makeView(terrain: Terrain, f: GroundField): FieldView {
    const oil = f.kind === 'oil';
    const edge = new GroundBand({ color: oil ? PAL.oil.edge : PAL.caltrops.edge, opacity: FIELD_LOOK.edge.opacity, renderOrder: FIELD_ORDER + 1, overTrucks: false });
    edge.set(terrain, f.pos, f.r - FIELD_LOOK.edge.width, f.r);
    this.root.add(edge.mesh);
    if (oil) {
      const fill = new GroundBand({ color: PAL.oil.sheen, opacity: FIELD_LOOK.sheen, renderOrder: FIELD_ORDER, overTrucks: false });
      fill.set(terrain, f.pos, 0, f.r - FIELD_LOOK.edge.width);
      const { r, shift, opacity } = FIELD_LOOK.gloss;
      const gloss = new GroundBand({ color: PAL.oil.gloss, opacity, renderOrder: FIELD_ORDER + 1, overTrucks: false });
      gloss.set(terrain, { x: f.pos.x - f.r * shift, y: f.pos.y - f.r * shift }, 0, f.r * r);
      for (const band of [fill, gloss]) this.root.add(band.mesh);
      return { spikes: null, fill: [fill, gloss], edge };
    }
    const spikes = this.scatter(terrain, f);
    this.root.add(spikes);
    return { spikes, fill: [], edge };
  }

  // Spikes spread evenly over the disk, each at its own lean, standing on the ground.
  private scatter(terrain: Terrain, f: GroundField): THREE.Group {
    const group = new THREE.Group();
    const seed = hashId(f.id);
    const count = Math.round(FIELD_LOOK.baseSpikes + FIELD_LOOK.spikesPerArea * Math.PI * f.r * f.r);
    for (let i = 0; i < count; i++) {
      const k = seed + i * 17;
      const r = Math.sqrt(hash2(k, 3)) * (f.r - FIELD_LOOK.edge.width);
      const a = hash2(k, 5) * 2 * Math.PI;
      const x = f.pos.x + Math.cos(a) * r;
      const y = f.pos.y + Math.sin(a) * r;
      const spike = new THREE.Mesh(this.spikeGeometry, this.spikeMaterial);
      spike.position.set(x * S, heightAt(terrain, x, y) * S + (FIELD_LOOK.spike.height * S) / 2, y * S);
      spike.rotation.set((hash2(k, 7) - 0.5) * 0.8, hash2(k, 11) * Math.PI, (hash2(k, 13) - 0.5) * 0.8);
      group.add(spike);
    }
    return group;
  }
}

// ---- Flares

const FLARE_ORDER = 906; // above smoke (905), below contact markers
const FLARE_LOOK = {
  height: 6, // tiles above the ground the flare hangs
  glow: 3, // tiles across the glow sprite
  edge: { width: 0.15, opacity: 0.7 }, // the ring at the edge of its light, in tiles
  light: { intensity: 60, reach: 1.6, decay: 1 }, // reach: the light's range as a share of the flare's radius
  flicker: { share: 0.25, speed: 6 }, // the glow and the light waver by this share, this many noise cycles a second
  lastTurn: 0.55, // brightness share in the flare's last turn, so a dying flare reads as ending
};

type FlareView = { glow: THREE.Sprite; edge: GroundBand };

class FlaresView {
  readonly root = new THREE.Group();
  private readonly views = new Map<string, FlareView>();
  private readonly texture = createGlowTexture();
  // A change in light count recompiles every material, so the pool only grows, to the most flares shown at once.
  // Unused lights stay dark.
  private readonly lights: THREE.PointLight[] = [];

  update(world: World, terrain: Terrain, nowMs: number): void {
    const shown = new Map(world.flares.filter((f) => flareShown(world, f)).map((f) => [f.id, f]));
    for (const [id, view] of this.views) if (!shown.has(id)) this.drop(id, view);
    while (this.lights.length < shown.size) this.addLight();
    this.lights.forEach((light) => (light.intensity = 0));
    [...shown.values()].forEach((f, i) => {
      const view = this.views.get(f.id) ?? this.makeView(terrain, f);
      this.place(terrain, view, this.lights[i], f, nowMs);
    });
  }

  private addLight(): void {
    const light = new THREE.PointLight(PAL.flare.light, 0, 0, FLARE_LOOK.light.decay);
    this.lights.push(light);
    this.root.add(light);
  }

  private makeView(terrain: Terrain, f: Flare): FlareView {
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, color: PAL.flare.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.renderOrder = FLARE_ORDER;
    glow.scale.setScalar(FLARE_LOOK.glow * S);
    glow.position.set(f.pos.x * S, (heightAt(terrain, f.pos.x, f.pos.y) + FLARE_LOOK.height) * S, f.pos.y * S);
    const edge = new GroundBand({ color: PAL.flare.edge, opacity: FLARE_LOOK.edge.opacity, renderOrder: FLARE_ORDER - 1, overTrucks: false });
    edge.set(terrain, f.pos, f.r - FLARE_LOOK.edge.width, f.r);
    this.root.add(glow, edge.mesh);
    const view = { glow, edge };
    this.views.set(f.id, view);
    return view;
  }

  private drop(id: string, view: FlareView): void {
    this.root.remove(view.glow, view.edge.mesh);
    view.glow.material.dispose();
    view.edge.dispose();
    this.views.delete(id);
  }

  // The glow and its light waver together, and dim in the flare's last turn.
  private place(terrain: Terrain, view: FlareView, light: THREE.PointLight, f: Flare, nowMs: number): void {
    const wave = 1 - FLARE_LOOK.flicker.share * valueNoise((nowMs / 1000) * FLARE_LOOK.flicker.speed, hashId(f.id) % 97);
    const bright = wave * (f.turnsLeft <= 1 ? FLARE_LOOK.lastTurn : 1);
    view.glow.material.opacity = bright;
    light.intensity = FLARE_LOOK.light.intensity * bright;
    light.distance = f.r * FLARE_LOOK.light.reach * S;
    light.position.copy(view.glow.position);
  }
}

// A flare shows within FLARE.seenRange of the player, and the player's own always does.
function flareShown(world: World, f: Flare): boolean {
  return f.source === world.player.vehicleId || dist(playerVehicle(world).pos, f.pos) <= FLARE.seenRange;
}

function createGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create flare texture');
  // A hot white core that fades out through the sprite's color.
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

// ---- Emitter pulses

const PULSE_ORDER = 906; // above smoke (905), below contact markers
const PULSE_LOOK = {
  sweepMs: 900, // the ring's time from the user out to the radius
  width: 0.5, // tiles across the ring
  opacity: 0.8, // at the start of the sweep, fading to 0 at its end
  sparks: 10, // per shut-down truck
  sparkSize: 0.7, // meters across a spark; a sprite, since points on the orthographic camera size in pixels
  sparkReach: 1.4, // meters from the truck's center a spark jumps to
  sparkHeight: 2.2, // meters above the truck's center the sparks spread up to, so most clear the body and show
};

type Ring = { band: GroundBand; pos: Vec; r: number; startMs: number };

class PulseView {
  readonly root = new THREE.Group();
  private readonly rings: Ring[] = [];
  private played = new Set<string>(); // pulse events of the shown turn whose ring has started
  private turn = -1;
  private readonly sparks = new Map<string, THREE.Group>(); // by vehicle id
  private readonly sparkMaterial = new THREE.SpriteMaterial({ map: createGlowTexture(), color: PAL.pulse.spark, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });

  update(world: World, terrain: Terrain, views: ReadonlyMap<string, VehicleView>, nowMs: number): void {
    this.startRings(world, nowMs);
    this.sweep(terrain, nowMs);
    this.crackle(world, views);
  }

  private startRings(world: World, nowMs: number): void {
    if (world.turn !== this.turn) {
      this.turn = world.turn;
      this.played = new Set();
    }
    for (const e of world.events) {
      if (e.t !== 'pulse' || this.played.has(e.vehicle) || !pulseShown(world, e)) continue;
      this.played.add(e.vehicle);
      const band = new GroundBand({ color: PAL.pulse.ring, opacity: PULSE_LOOK.opacity, renderOrder: PULSE_ORDER, overTrucks: false });
      this.root.add(band.mesh);
      this.rings.push({ band, pos: e.pos, r: pulseEffect(world, e.vehicle).radius, startMs: nowMs });
    }
  }

  // Each ring sweeps out with a fast start and fades; a finished ring is dropped.
  private sweep(terrain: Terrain, nowMs: number): void {
    for (const ring of [...this.rings]) {
      const t = (nowMs - ring.startMs) / PULSE_LOOK.sweepMs;
      if (t >= 1) {
        this.root.remove(ring.band.mesh);
        ring.band.dispose();
        this.rings.splice(this.rings.indexOf(ring), 1);
        continue;
      }
      const outer = Math.max(PULSE_LOOK.width, ring.r * (1 - (1 - t) ** 2));
      ring.band.set(terrain, ring.pos, outer - PULSE_LOOK.width, outer);
      ring.band.mesh.material.opacity = PULSE_LOOK.opacity * (1 - t);
    }
  }

  // Sparks jump to new spots around each drawn truck with shut-down turns ahead, every frame.
  private crackle(world: World, views: ReadonlyMap<string, VehicleView>): void {
    const shut = shutDownViews(world, views);
    for (const [id, group] of this.sparks) {
      if (shut.has(id)) continue;
      this.root.remove(group);
      this.sparks.delete(id);
    }
    for (const [id, view] of shut) jump(this.sparksOf(id), view.center());
  }

  private sparksOf(id: string): THREE.Group {
    const known = this.sparks.get(id);
    if (known) return known;
    const group = new THREE.Group();
    for (let i = 0; i < PULSE_LOOK.sparks; i++) {
      const spark = new THREE.Sprite(this.sparkMaterial);
      spark.renderOrder = PULSE_ORDER;
      spark.frustumCulled = false;
      group.add(spark);
    }
    this.root.add(group);
    this.sparks.set(id, group);
    return group;
  }
}

// The drawn trucks with shut-down turns ahead, by vehicle id.
function shutDownViews(world: World, views: ReadonlyMap<string, VehicleView>): Map<string, VehicleView> {
  const shut = new Map<string, VehicleView>();
  for (const v of world.vehicles) {
    const view = views.get(v.id);
    if (view && shutDownTurnsLeft(world, v) > 0) shut.set(v.id, view);
  }
  return shut;
}

// The player sees a pulse it fired or that hit it, or one whose user or a hit truck it sees.
function pulseShown(world: World, e: Extract<GameEvent, { t: 'pulse' }>): boolean {
  const me = world.player.vehicleId;
  if (e.vehicle === me || e.hit.includes(me) || playerSees(world, e.pos)) return true;
  return e.hit.some((id) => {
    const v = world.vehicles.find((x) => x.id === id);
    return v !== undefined && playerSees(world, v.pos);
  });
}

// Scatters the sparks around a truck's center. Render only, so Math.random() is fine: sparks need no repeatable pattern.
function jump(group: THREE.Group, at: { x: number; y: number; z: number }): void {
  for (const spark of group.children) {
    const a = Math.random() * 2 * Math.PI;
    const r = Math.random() * PULSE_LOOK.sparkReach;
    spark.position.set(at.x + Math.cos(a) * r, at.y + PULSE_LOOK.sparkHeight * Math.random(), at.z + Math.sin(a) * r);
    spark.scale.setScalar(PULSE_LOOK.sparkSize * (0.5 + Math.random()));
  }
}
