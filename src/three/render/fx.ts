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
type FloatText = { el: HTMLDivElement; pos: V3; age: number; life: number; used: boolean };
type Tracer = { line: THREE.Line; age: number; life: number };

export class Fx3D {
  private puffs: Puff[] = [];
  private texts: FloatText[] = [];
  private tracers: Tracer[] = [];

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
      this.texts.push({ el, pos: { x: 0, y: 0, z: 0 }, age: 0, life: 1, used: false });
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

  shot(from: V3, to: V3, hit: boolean, damage: number, heavy: boolean): void {
    const miss = hit ? { x: 0, z: 0 } : { x: (Math.random() - 0.5) * 3, z: (Math.random() - 0.5) * 3 };
    const b: V3 = { x: to.x + miss.x, y: to.y, z: to.z + miss.z };
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(from.x, from.y, from.z), new THREE.Vector3(b.x, b.y, b.z)]);
    const mat = new THREE.LineBasicMaterial({ color: PAL.flash, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, age: 0, life: heavy ? 0.35 : 0.2 });
    this.puff(from, PAL.flash, 1, { speed: 0, life: 0.15, scale: heavy ? 0.9 : 0.5, grow: 1.6, additive: true });
    if (hit) {
      this.puff(b, 0xffa040, heavy ? 14 : 6, { speed: 4, life: 0.35, scale: 0.35, grow: 0.3, additive: true });
      this.floatText(b, `-${damage}`, '#ffb070');
    } else {
      this.floatText(b, 'miss', '#c8b898');
    }
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

  floatText(p: V3, text: string, color: string): void {
    const slot = this.texts.find((x) => !x.used) ?? this.texts.reduce((a, b) => (a.age > b.age ? a : b));
    slot.used = true;
    slot.age = 0;
    slot.life = 1.1;
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
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.age += dt;
      if (tr.age >= tr.life) {
        this.scene.remove(tr.line);
        tr.line.geometry.dispose();
        (tr.line.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
        continue;
      }
      (tr.line.material as THREE.LineBasicMaterial).opacity = 0.9 * (1 - tr.age / tr.life);
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
      slot.el.style.top = `${screen.y}px`;
      slot.el.style.opacity = `${1 - t}`;
    }
  }
}
