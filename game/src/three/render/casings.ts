// Spent brass a gun throws out as each round fires. A casing leaves from behind the muzzle, flies out to the gun's
// right side and up, bounces once on the ground or deck and lies flat. Casings stay a day of turns and shrink away in
// the last tenth of it. Render-only: never saved, so they are gone after a load, and never read by sim or physics.

import * as THREE from 'three';
import { TIME } from '../../data/time';
import { groundPoint, toMap } from '../../phys/frames';
import { PAL } from '../../render/palette';
import type { Terrain } from '../../sim/terrain';
import type { Muzzle } from './projectiles';

export type CasingSize = 'small' | 'large';

// Sizes are larger than real brass on purpose, so a casing reads from the isometric camera.
export const CASING = {
  max: 400, // casings alive at once, both sizes together; a new one past it replaces the oldest
  lifeTurns: TIME.turnsPerDay,
  fadeShare: 0.1, // the last share of the life over which a casing shrinks away
  small: { length: 0.12, radius: 0.03 }, // meters
  large: { length: 0.3, radius: 0.07 },
  back: 0.6, // meters behind the muzzle along the barrel where the casing leaves the breech
  eject: { side: 2.4, up: 2.2, spread: 0.8, spin: 18 }, // m/s out to the right and up, ± m/s of spread, rad/s of tumble
  gravity: 9.8, // m/s^2
  bounce: 0.35, // share of the falling speed kept by the one bounce
  slide: 0.4, // share of the ground speed kept by the bounce
} as const;

type Casing = {
  size: CasingSize;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number; // radians about up
  roll: number; // radians of tumble about the casing's own axis line
  spin: number; // rad/s of tumble while flying
  bounced: boolean;
  resting: boolean;
  turn: number; // the turn it was thrown in
};

const SIZES: CasingSize[] = ['small', 'large'];
const UP = new THREE.Vector3(0, 1, 0);
const AXIS = new THREE.Vector3(1, 0, 0); // a casing's length, before its yaw

export class Casings {
  readonly meshes: Record<CasingSize, THREE.InstancedMesh>;
  private casings: Casing[] = []; // oldest first
  private matrix = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private tumble = new THREE.Quaternion();
  private scale = new THREE.Vector3();
  private material = new THREE.MeshLambertMaterial({ color: PAL.brass, flatShading: true });

  constructor(private scene: THREE.Scene) {
    this.meshes = { small: casingMesh(CASING.small, this.material), large: casingMesh(CASING.large, this.material) };
    scene.add(this.meshes.small, this.meshes.large);
  }

  // Throws one casing from the gun as its round fires. A gun with no casing (size null) throws nothing.
  eject(muzzle: Muzzle, size: CasingSize | null, turn: number): void {
    if (size === null) return;
    const dir = new THREE.Vector3(muzzle.dir.x, muzzle.dir.y, muzzle.dir.z).normalize();
    const flat = Math.hypot(dir.x, dir.z);
    if (!(flat > 0)) throw new Error('A casing needs a muzzle pointing off the vertical, to know its right side');
    // Positive offsets across the line of fire are the shooter's right, as in computeRoundPoint.
    const right = new THREE.Vector3(-dir.z / flat, 0, dir.x / flat);
    const pos = new THREE.Vector3(muzzle.pos.x, muzzle.pos.y, muzzle.pos.z).addScaledVector(dir, -CASING.back);
    const e = CASING.eject;
    const vel = right.multiplyScalar(e.side + spread()).addScaledVector(UP, e.up + spread()).addScaledVector(dir, spread());
    if (this.casings.length >= CASING.max) this.casings.shift();
    const yaw = -Math.atan2(dir.z, dir.x);
    this.casings.push({ size, pos, vel, yaw, roll: 0, spin: e.spin * (Math.random() + 0.5), bounced: false, resting: false, turn });
  }

  // Moves flying casings, drops the expired ones and draws the rest. terrain gives the ground or deck height.
  tick(dt: number, terrain: Terrain, turn: number): void {
    this.casings = this.casings.filter((c) => turn - c.turn < CASING.lifeTurns);
    for (const c of this.casings) if (!c.resting) this.fly(c, dt, terrain);
    this.draw(turn);
  }

  dispose(): void {
    this.scene.remove(this.meshes.small, this.meshes.large);
    for (const size of SIZES) this.meshes[size].geometry.dispose();
    this.material.dispose();
  }

  // A simple arc under gravity. The first touch of the ground bounces it, the second lays it flat at a random yaw.
  private fly(c: Casing, dt: number, terrain: Terrain): void {
    c.vel.y -= CASING.gravity * dt;
    c.pos.addScaledVector(c.vel, dt);
    c.roll += c.spin * dt;
    const rest = groundPoint(terrain, toMap(c.pos)).y + CASING[c.size].radius;
    if (c.pos.y > rest) return;
    c.pos.y = rest;
    if (c.bounced) return this.lay(c);
    c.bounced = true;
    c.vel.set(c.vel.x * CASING.slide, -c.vel.y * CASING.bounce, c.vel.z * CASING.slide);
  }

  private lay(c: Casing): void {
    c.resting = true;
    c.vel.set(0, 0, 0);
    c.yaw = Math.random() * Math.PI * 2;
    c.roll = 0;
  }

  private draw(turn: number): void {
    const counts: Record<CasingSize, number> = { small: 0, large: 0 };
    for (const c of this.casings) {
      this.quat.setFromAxisAngle(UP, c.yaw).multiply(this.tumble.setFromAxisAngle(AXIS, c.roll));
      this.scale.setScalar(fadeOf(turn - c.turn));
      this.matrix.compose(c.pos, this.quat, this.scale);
      this.meshes[c.size].setMatrixAt(counts[c.size]++, this.matrix);
    }
    for (const size of SIZES) {
      this.meshes[size].count = counts[size];
      this.meshes[size].instanceMatrix.needsUpdate = true;
    }
  }
}

// The size share left at an age in turns: whole until the last fadeShare of the life, then down toward nothing.
function fadeOf(age: number): number {
  const fade = CASING.lifeTurns * CASING.fadeShare;
  return Math.min(1, (CASING.lifeTurns - age) / fade);
}

function spread(): number {
  return (Math.random() * 2 - 1) * CASING.eject.spread;
}

// A six-sided brass cylinder lying along +x, one instance per casing of a size.
function casingMesh(size: { length: number; radius: number }, material: THREE.Material): THREE.InstancedMesh {
  const geo = new THREE.CylinderGeometry(size.radius, size.radius, size.length, 6).rotateZ(Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, material, CASING.max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false; // casings land anywhere; the bounds of one casing mean nothing
  return mesh;
}
