// Vehicles built from boxes, in physics-accurate scale. Chassis box and wheel positions come
// straight from bodyOf()/wheelMounts() so the model matches the physics collider exactly.
// Look depends on chassis, faction and installed parts, like src/render/vehicle.ts (the 2D version).

import * as THREE from 'three';
import { chassisDef, type ChassisDef } from '../../data/chassis';
import { partDef } from '../../data/parts';
import { PHYSICS } from '../../data/physics';
import { wheelMounts } from '../../phys/body';
import { bodyOf, type Body } from '../../sim/body';
import { headingOf, headingQuat, type VehicleFrame } from '../../phys/frames';
import { FACTION_COLORS, PAL, shade } from '../../render/palette';
import { baseGrid, itemCells, mountedItems, mountedParts, sideOf, type SideLetter } from '../../sim/grid';
import type { Vehicle } from '../../sim/types';

const S = PHYSICS.metersPerTile;
const T = PHYSICS.truck;

export type Ring3 = { r: number; width: number; color: number; alpha: number };

type Look = ChassisDef['look'];

// Body shape features as fractions of the chassis half-length (x) and half-height (y).
// turretX/cargoFrom/cargoTo/cageX are along x; cabHeight is a fraction of half.y.
type Shape = {
  cabFrom: number;
  cabTo: number;
  cabHeight: number;
  turretX: number;
  cargoFrom: number;
  cargoTo: number;
  cageX: number;
};

const SHAPES: Record<Look, Shape> = {
  pickup: { cabFrom: 0.05, cabTo: 0.85, cabHeight: 1.1, turretX: 0.55, cargoFrom: -0.9, cargoTo: 0.0, cageX: 0.85 },
  hauler: { cabFrom: 0.1, cabTo: 0.75, cabHeight: 1.1, turretX: 0.5, cargoFrom: -0.9, cargoTo: 0.15, cageX: 0.9 },
  buggy: { cabFrom: -0.5, cabTo: 0.35, cabHeight: 0.8, turretX: -0.1, cargoFrom: -0.85, cargoTo: -0.4, cageX: 0.8 },
  wagon: { cabFrom: 0.55, cabTo: 0.9, cabHeight: 0.7, turretX: 0.15, cargoFrom: -0.85, cargoTo: -0.2, cageX: 0.9 },
  courier: { cabFrom: -0.15, cabTo: 0.6, cabHeight: 0.75, turretX: 0.1, cargoFrom: -0.9, cargoTo: -0.25, cageX: 0.8 },
  van: { cabFrom: -0.7, cabTo: 0.8, cabHeight: 1.5, turretX: 0.45, cargoFrom: -0.8, cargoTo: -0.1, cageX: 0.85 },
  longbed: { cabFrom: 0.45, cabTo: 0.9, cabHeight: 1.2, turretX: 0.6, cargoFrom: -0.95, cargoTo: 0.35, cageX: 0.9 },
  carrier: { cabFrom: -0.6, cabTo: 0.8, cabHeight: 0.65, turretX: 0.25, cargoFrom: -0.85, cargoTo: -0.4, cageX: 0.9 },
  tractor: { cabFrom: -0.15, cabTo: 0.55, cabHeight: 1.4, turretX: 0.2, cargoFrom: -0.9, cargoTo: -0.25, cageX: 0.95 },
};

const PLATE_THICK = 0.12; // plate thickness as a fraction of the chassis half-width
const RAM_DEPTH = 0.5; // how far a ram wedge sticks out, as a fraction of the chassis half-width

// Yaw that turns a side piece's local +x outward. Local +x is the nose and local +z the truck's right.
const SIDE_YAW: Record<SideLetter, number> = { F: 0, B: Math.PI, R: -Math.PI / 2, L: Math.PI / 2 };

// A triangular prism with its base on x = 0, its tip at x = 1, across z from -0.5 to 0.5 and y from -0.5 to 0.5.
function wedgeGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, 1, 3).rotateY(Math.PI / 2).translate(0.5, 0, 0);
  return g.scale(1 / 1.5, 1, 1 / Math.sqrt(3));
}

type Wheel = { mount: THREE.Group; spin: THREE.Mesh; restY: number };

// A model rebuilds only when this changes: chassis, faction, and each visually relevant
// (non-engine) mounted part's def and damage state.
function signatureOf(v: Vehicle): string {
  const parts = mountedItems(v)
    .filter((it) => partDef(it.part.defId).kind !== 'engine')
    .map((it) => `${it.part.defId}@${it.x},${it.y},${it.rot}:${it.part.hp > 0 ? 1 : 0}`)
    .join(',');
  return `${v.chassisId}|${v.faction}|${parts}`;
}

export class VehicleView {
  readonly root = new THREE.Group();
  readonly ground = new THREE.Group();

  private sig = '';
  private wheels: Wheel[] = [];
  private turrets: THREE.Group[] = [];
  private ringMeshes: THREE.Mesh[] = [];
  private heading = 0;
  private groundOffset = 0;

  constructor(v: Vehicle) {
    this.update(v);
  }

  update(v: Vehicle): void {
    const sig = signatureOf(v);
    if (sig === this.sig) return;
    this.sig = sig;
    this.rebuild(v);
  }

  pose(f: VehicleFrame): void {
    this.root.position.set(f.pos.x, f.pos.y, f.pos.z);
    this.root.quaternion.set(f.rot.x, f.rot.y, f.rot.z, f.rot.w);
    this.heading = headingOf(f.rot);
    f.wheels.forEach((w, i) => {
      const wheel = this.wheels[i];
      if (!wheel) return;
      wheel.mount.position.y = wheel.restY - w.suspension;
      wheel.mount.rotation.y = w.steer;
      wheel.spin.rotation.z = -w.spin;
    });
    this.ground.position.set(f.pos.x, f.pos.y - this.groundOffset, f.pos.z);
  }

  // yaw is a map-space heading (radians, 0 = +x). null points turrets forward.
  aim(yaw: number | null): void {
    const delta = yaw === null ? 0 : yaw - this.heading;
    const q = headingQuat(delta);
    for (const turret of this.turrets) turret.quaternion.set(q.x, q.y, q.z, q.w);
  }

  rings(rs: Ring3[]): void {
    for (const m of this.ringMeshes) {
      this.ground.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.ringMeshes = rs.map((r) => {
      const inner = Math.max(0.01, r.r - r.width / 2) * S;
      const outer = (r.r + r.width / 2) * S;
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(inner, outer, 48).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: r.color, transparent: true, opacity: r.alpha, depthWrite: false, side: THREE.DoubleSide }),
      );
      mesh.position.y = 0.02; // clears z-fighting with the ground mesh
      mesh.renderOrder = 5;
      this.ground.add(mesh);
      return mesh;
    });
  }

  dispose(): void {
    disposeChildren(this.root);
    disposeChildren(this.ground);
  }

  private rebuild(v: Vehicle): void {
    disposeChildren(this.root);
    this.wheels = [];
    this.turrets = [];
    const ch = chassisDef(v.chassisId);
    const body = bodyOf(v.chassisId);
    const shape = SHAPES[ch.look];
    const col = FACTION_COLORS[v.faction];
    this.groundOffset = body.wheelRadius + T.suspensionRest;

    this.buildFrame(body, col);
    this.buildCab(body, shape, col);
    this.buildWheels(body);
    this.buildArmor(v, body, shape);
    this.buildCargo(v, body, shape);
    this.buildWeapons(v, body, shape);
  }

  private buildFrame(body: Body, col: (typeof FACTION_COLORS)['player']): void {
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(body.half.x * 2, body.half.y * 2, body.half.z * 2),
      new THREE.MeshLambertMaterial({ color: col.side, flatShading: true }),
    );
    frame.castShadow = true;
    frame.receiveShadow = true;
    this.root.add(frame);
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(body.half.x * 1.96, body.half.y * 0.3, body.half.z * 1.96),
      new THREE.MeshLambertMaterial({ color: col.top, flatShading: true }),
    );
    deck.position.y = body.half.y + (body.half.y * 0.3) / 2;
    deck.castShadow = true;
    this.root.add(deck);
  }

  private buildCab(body: Body, shape: Shape, col: (typeof FACTION_COLORS)['player']): void {
    const from = shape.cabFrom * body.half.x;
    const to = shape.cabTo * body.half.x;
    const height = shape.cabHeight * body.half.y * 2;
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(Math.abs(to - from), height, body.half.z * 1.8),
      new THREE.MeshLambertMaterial({ color: col.cab, flatShading: true }),
    );
    cab.position.set((from + to) / 2, body.half.y + height / 2, 0);
    cab.castShadow = true;
    this.root.add(cab);
  }

  private buildWheels(body: Body): void {
    const geo = new THREE.CylinderGeometry(body.wheelRadius, body.wheelRadius, body.wheelHalfWidth * 2, 16).rotateX(Math.PI / 2);
    const rubber = new THREE.MeshLambertMaterial({ color: PAL.wheel });
    const hubGeo = new THREE.BoxGeometry(body.wheelRadius * 1.2, body.wheelRadius * 0.4, body.wheelHalfWidth * 2.1);
    const hubMat = new THREE.MeshLambertMaterial({ color: PAL.metalLight });
    for (const m of wheelMounts(body)) {
      const mount = new THREE.Group();
      mount.position.set(m.x, m.y - T.suspensionRest, m.z);
      const spin = new THREE.Mesh(geo, rubber);
      spin.castShadow = true;
      spin.add(new THREE.Mesh(hubGeo, hubMat));
      mount.add(spin);
      this.root.add(mount);
      this.wheels.push({ mount, spin, restY: m.y });
    }
  }

  // Plates and rams sit on the side they are mounted on, over the span their grid cells cover.
  private buildArmor(v: Vehicle, body: Body, shape: Shape): void {
    for (const p of mountedParts(v, 'armor')) {
      const def = partDef(p.defId);
      if (def.kind !== 'armor') throw new Error(`${p.id} is mounted as armor but is ${def.kind}`);
      const tone = p.hp > 0 ? 1 : 0.6;
      const side = sideOf(v, p);
      if (!side) throw new Error(`Armor ${p.id} is mounted off a side letter`);
      if (def.look === 'cage') {
        // A cage: bars rising above the cab, so it reads from the iso view instead of hiding under it.
        const cabTop = body.half.y + shape.cabHeight * body.half.y * 2;
        const barMat = new THREE.MeshLambertMaterial({ color: shade(PAL.metal, tone * 0.85), flatShading: true });
        for (const level of [0.2, 0.55, 0.9]) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(body.half.x * 0.08, body.half.y * 0.18, body.half.z * 1.9), barMat);
          bar.position.set(shape.cageX * body.half.x, cabTop + level * body.half.y, 0);
          bar.castShadow = true;
          this.root.add(bar);
        }
        continue;
      }
      const span = cellSpan(v, p.id, side, body);
      const plate = def.look === 'plates';
      const depth = body.half.z * (plate ? PLATE_THICK : RAM_DEPTH);
      const geo = plate ? new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0, 0) : wedgeGeometry();
      geo.scale(depth, body.half.y * (plate ? 1.6 : 0.9), span.width);
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: shade(plate ? PAL.metal : PAL.metalLight, tone), flatShading: true }));
      mesh.rotation.y = SIDE_YAW[side];
      mesh.position.copy(sidePoint(side, span.center, body)).setY(body.half.y * (plate ? 0.9 : 0.6));
      mesh.castShadow = true;
      this.root.add(mesh);
    }
  }

  private buildCargo(v: Vehicle, body: Body, shape: Shape): void {
    for (const p of mountedParts(v, 'cargo')) {
      const def = partDef(p.defId);
      if (def.kind !== 'cargo') continue;
      const from = shape.cargoFrom * body.half.x;
      const to = shape.cargoTo * body.half.x;
      const y = body.half.y * 2 + 0.15 * S;
      if (def.look === 'box') {
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(Math.abs(to - from), 0.3 * S, body.half.z * 1.7),
          new THREE.MeshLambertMaterial({ color: PAL.crate, flatShading: true }),
        );
        box.position.set((from + to) / 2, y + 0.15 * S, 0);
        box.castShadow = true;
        this.root.add(box);
      } else {
        const rack = new THREE.Mesh(
          new THREE.BoxGeometry(Math.abs(to - from), 0.08 * S, body.half.z * 1.7),
          new THREE.MeshLambertMaterial({ color: shade(PAL.crate, 0.8), flatShading: true }),
        );
        rack.position.set((from + to) / 2, y, 0);
        rack.castShadow = true;
        this.root.add(rack);
      }
    }
  }

  private buildWeapons(v: Vehicle, body: Body, shape: Shape): void {
    let mount = 0;
    for (const p of mountedParts(v, 'weapon')) {
      const def = partDef(p.defId);
      if (def.kind !== 'weapon') continue;
      const tone = p.hp > 0 ? 1 : 0.5;
      const localX = shape.turretX * body.half.x - mount * 0.4 * S;
      mount++;
      const turret = new THREE.Group();
      turret.position.set(localX, body.half.y * 2, 0);
      this.root.add(turret);
      this.turrets.push(turret);
      const big = def.look === 'cannon';
      const baseSize = big ? 0.4 * S : 0.24 * S;
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(baseSize, baseSize * 0.7, baseSize),
        new THREE.MeshLambertMaterial({ color: shade(PAL.metal, tone), flatShading: true }),
      );
      base.position.y = (baseSize * 0.7) / 2;
      base.castShadow = true;
      turret.add(base);
      const len = big ? 0.95 * S : 0.5 * S;
      const width = big ? 0.16 * S : 0.08 * S;
      const barrel = new THREE.Mesh(
        new THREE.BoxGeometry(len, width, width),
        new THREE.MeshLambertMaterial({ color: shade(PAL.metalLight, tone), flatShading: true }),
      );
      barrel.position.set(len / 2, base.position.y, 0);
      barrel.castShadow = true;
      turret.add(barrel);
    }
  }
}

// Where a part's grid cells lie along a side, in body meters. The grid is a top view with the nose on row 0 and
// the truck's left on column 0. Front and back parts span across the body, left and right parts along it.
function cellSpan(v: Vehicle, partId: string, side: SideLetter, body: Body): { center: number; width: number } {
  const item = v.items.find((it) => it.kind === 'part' && it.part.id === partId);
  if (!item) throw new Error(`Part ${partId} is not on ${v.id}`);
  const grid = baseGrid(v.chassisId);
  const cells = itemCells(item);
  const across = side === 'F' || side === 'B';
  const lo = Math.min(...cells.map((c) => (across ? c.x : c.y)));
  const hi = Math.max(...cells.map((c) => (across ? c.x : c.y))) + 1;
  if (across) {
    const cell = (body.half.z * 2) / grid.w;
    return { center: -body.half.z + ((lo + hi) / 2) * cell, width: (hi - lo) * cell };
  }
  const cell = (body.half.x * 2) / grid.h;
  return { center: body.half.x - ((lo + hi) / 2) * cell, width: (hi - lo) * cell };
}

// The point on a side's edge at `along`, across the body for front and back, along it for left and right.
function sidePoint(side: SideLetter, along: number, body: Body): THREE.Vector3 {
  if (side === 'F') return new THREE.Vector3(body.half.x, 0, along);
  if (side === 'B') return new THREE.Vector3(-body.half.x, 0, along);
  if (side === 'R') return new THREE.Vector3(along, 0, body.half.z);
  return new THREE.Vector3(along, 0, -body.half.z);
}

function disposeChildren(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
      }
    });
  }
}
