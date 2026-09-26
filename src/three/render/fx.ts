// Short-lived combat and movement effects: tracers, muzzle flash, sparks, smoke, dust and floating
// damage numbers, like the 2D src/render/fx.ts. Particles are pooled sprites that age and recycle,
// so any number of effects in a turn costs a fixed amount.

import * as THREE from 'three';
import type { V3 } from '../../phys/frames';
import { PAL } from '../../render/palette';
import type { CameraRig } from './camera';

const MAX_PUFFS = 200; // pool size; effects beyond this are dropped rather than growing unbounded
const MAX_TEXTS = 24;
const GRAVITY = 2; // m/s^2 pulling sparks and dust down; a soft fraction of real gravity, for looks
const RISE_METERS = 1.5; // how far a floating number drifts up over its life
const CANNON_COLOR = 0xffad50;
const MG_BOLT = 0.04; // bolt length as a share of the flight
const CANNON_BOLT = 0.06;
const LABEL_ROW_PX = 22; // screen spacing between stacked shot labels

let dotTexture: THREE.Texture | null = null;
function dotMap(): THREE.Texture {
  if (dotTexture) return dotTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 16);
  dotTexture = new THREE.CanvasTexture(c);
  return dotTexture;
}

type Puff = { sprite: THREE.Sprite; vel: THREE.Vector3; age: number; life: number; fromScale: number; toScale: number; used: boolean };
type FloatText = { el: HTMLDivElement; pos: V3; rowPx: number; age: number; life: number; used: boolean };
// A round in flight: after its delay a bolt runs from muzzle to landing point over its life, then the impact plays.
type Tracer = { line: THREE.LineSegments; from: THREE.Vector3; to: THREE.Vector3; heavy: boolean; age: number; life: number; fire: () => void; land: () => void };
type Pending = { left: number; run: () => void }; // seconds until run

export class Fx3D {
  private puffs: Puff[] = [];
  private texts: FloatText[] = [];
  private tracers: Tracer[] = [];
  private pending: Pending[] = [];

  constructor(private scene: THREE.Scene, private overlay: HTMLElement, private rig: CameraRig) {
    for (let i = 0; i < MAX_PUFFS; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotMap(), transparent: true, depthWrite: false }));
      sprite.visible = false;
      scene.add(sprite);
      this.puffs.push({ sprite, vel: new THREE.Vector3(), age: 0, life: 1, fromScale: 1, toScale: 1, used: false });
    }
    for (let i = 0; i < MAX_TEXTS; i++) {
      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.transform = 'translate(-50%, -50%)';
      el.style.font = 'bold 15px monospace';
      el.style.textShadow = '0 1px 2px #1a1410';
      el.style.pointerEvents = 'none';
      el.style.display = 'none';
      overlay.appendChild(el);
      this.texts.push({ el, pos: { x: 0, y: 0, z: 0 }, rowPx: 0, age: 0, life: 1, used: false });
    }
  }

  private puff(p: V3, color: number, count: number, opts: { speed: number; life: number; scale: number; grow: number; additive?: boolean }): void {
    for (let i = 0; i < count; i++) {
      const slot = this.puffs.find((x) => !x.used);
      if (!slot) return; // pool exhausted; drop the extra rather than grow unbounded
      slot.used = true;
      slot.age = 0;
      slot.life = opts.life;
      slot.fromScale = opts.scale;
      slot.toScale = opts.scale * opts.grow;
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.6;
      const s = opts.speed * (0.4 + Math.random() * 0.6);
      slot.vel.set(Math.cos(a) * s, up * s, Math.sin(a) * s);
      slot.sprite.position.set(p.x, p.y, p.z);
      slot.sprite.scale.setScalar(opts.scale);
      const mat = slot.sprite.material as THREE.SpriteMaterial;
      mat.color.setHex(color);
      mat.opacity = 1;
      mat.blending = opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      slot.sprite.visible = true;
    }
  }

  // One round leaves `from` after delayMs and reaches its landing point after flightMs more. It lands with sparks
  // when it struck something, else with dust.
  shot(from: V3, land: V3, sparks: boolean, heavy: boolean, delayMs: number, flightMs: number): void {
    const color = heavy ? CANNON_COLOR : PAL.flash;
    const line = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 }));
    line.visible = false;
    this.scene.add(line);
    const fire = () => {
      line.visible = true;
      this.puff(from, PAL.flash, 1, { speed: 0, life: flightMs / 2000, scale: heavy ? 0.9 : 0.5, grow: 1.6, additive: true });
    };
    const impact = () => {
      if (sparks) this.puff(land, 0xffa040, heavy ? 14 : 6, { speed: 4, life: 0.35, scale: 0.35, grow: 0.3, additive: true });
      else this.puff(land, 0xd8c098, 4, { speed: 1.5, life: 0.9, scale: 0.5, grow: 1.4 });
    };
    const tracer: Tracer = { line, from: new THREE.Vector3(from.x, from.y, from.z), to: new THREE.Vector3(land.x, land.y, land.z), heavy, age: -delayMs / 1000, life: flightMs / 1000, fire, land: impact };
    this.tracers.push(tracer);
  }

  // A floating label that appears at p after delayMs and reads for readMs. row stacks labels at the same point.
  label(p: V3, text: string, color: string, row: number, delayMs: number, readMs: number): void {
    this.pending.push({ left: delayMs / 1000, run: () => this.floatText(p, text, color, readMs, row * LABEL_ROW_PX) });
  }

  explode(p: V3): void {
    this.puff(p, 0xffa040, 30, { speed: 6, life: 0.4, scale: 0.4, grow: 0.3, additive: true });
    this.puff(p, 0x3a3028, 16, { speed: 3, life: 1.6, scale: 1.0, grow: 2.4 });
    this.puff(p, 0xffc060, 1, { speed: 0, life: 0.4, scale: 3.2, grow: 1.6, additive: true });
  }

  crash(p: V3): void {
    this.puff(p, 0xffa040, 10, { speed: 5, life: 0.35, scale: 0.35, grow: 0.3, additive: true });
    this.dust(p);
  }

  dust(p: V3): void {
    this.puff(p, 0xd8c098, 1, { speed: 1.2, life: 0.9, scale: 0.5, grow: 1.4 });
  }

  smoke(p: V3): void {
    this.puff(p, 0x4a3f32, 1, { speed: 1.5, life: 1.6, scale: 0.8, grow: 2.4 });
  }

  floatText(p: V3, text: string, color: string, durationMs: number, rowPx = 0): void {
    const slot = this.texts.find((x) => !x.used) ?? this.texts.reduce((a, b) => (a.age > b.age ? a : b));
    slot.used = true;
    slot.age = 0;
    slot.life = durationMs / 1000;
    slot.rowPx = rowPx;
    slot.pos = { x: p.x, y: p.y, z: p.z };
    slot.el.textContent = text;
    slot.el.style.color = color;
    slot.el.style.display = 'block';
    slot.el.style.opacity = '1';
  }

  tick(dtMs: number): void {
    const dt = dtMs / 1000;
    for (const slot of this.puffs) {
      if (!slot.used) continue;
      slot.age += dt;
      if (slot.age >= slot.life) {
        slot.used = false;
        slot.sprite.visible = false;
        continue;
      }
      const t = slot.age / slot.life;
      slot.sprite.position.addScaledVector(slot.vel, dt);
      slot.vel.y -= GRAVITY * dt;
      slot.sprite.scale.setScalar(slot.fromScale + (slot.toScale - slot.fromScale) * t);
      (slot.sprite.material as THREE.SpriteMaterial).opacity = 1 - t;
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const job = this.pending[i];
      job.left -= dt;
      if (job.left > 0) continue;
      this.pending.splice(i, 1);
      job.run();
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      const before = tr.age;
      tr.age += dt;
      if (tr.age < 0) continue;
      if (before <= 0) tr.fire(); // the delay ran out this frame
      if (tr.age >= tr.life) {
        this.scene.remove(tr.line);
        tr.line.geometry.dispose();
        (tr.line.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
        tr.land();
        continue;
      }
      const head = tr.age / tr.life;
      const tail = Math.max(0, head - (tr.heavy ? CANNON_BOLT : MG_BOLT));
      const points = [tr.from.clone().lerp(tr.to, tail), tr.from.clone().lerp(tr.to, head)];
      tr.line.geometry.dispose();
      tr.line.geometry = new THREE.BufferGeometry().setFromPoints(points);
    }
    for (const slot of this.texts) {
      if (!slot.used) continue;
      slot.age += dt;
      if (slot.age >= slot.life) {
        slot.used = false;
        slot.el.style.display = 'none';
        continue;
      }
      const t = slot.age / slot.life;
      const screen = this.rig.screenOf({ x: slot.pos.x, y: slot.pos.y + t * RISE_METERS, z: slot.pos.z });
      slot.el.style.left = `${screen.x}px`;
      slot.el.style.top = `${screen.y - slot.rowPx}px`;
      slot.el.style.opacity = `${1 - t}`;
    }
  }
}
