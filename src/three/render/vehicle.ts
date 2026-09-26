// Trucks drawn as open rigs of Blender part models on the chassis grid.
// The frame outlines the physics collider, one deck tile covers each grid cell, and every grid item draws its model on its own cells.
// Body space: +x is the nose, +z the truck's right, +y up, origin at the collider center. Models share that frame.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { chassisDef } from '../../data/chassis';
import { partDef, type PartKind } from '../../data/parts';
import { PHYSICS } from '../../data/physics';
import { wheelMounts } from '../../phys/body';
import { bodyOf, cellCenter, type Body } from '../../sim/body';
import { headingOf, headingQuat, type VehicleFrame } from '../../phys/frames';
import { FACTION_COLORS, PAL } from '../../render/palette';
import { partModel, weaponLook } from '../../render/partLooks';
import { baseGrid, isMounted, itemCells, itemSize, sideOf, type SideLetter } from '../../sim/grid';
import type { GridItem, Vehicle } from '../../sim/types';
import { model, socket } from './models';

const S = PHYSICS.metersPerTile;
const T = PHYSICS.truck;
const CELL = PHYSICS.cell;

export type Ring3 = { r: number; width: number; color: number; alpha: number };

type PartItem = Extract<GridItem, { kind: 'part' }>;

// Material name that takes the faction color.
const PAINT = 'paint';

// Color factor for every material of a broken part.
const BROKEN_TONE: Record<PartKind, number> = { weapon: 0.5, armor: 0.6, engine: 0.6, cargo: 0.6, core: 0.6 };

// Yaw for rotation 1. Local +x, the model's front, turns to the truck's left.
const ROT_YAW = Math.PI / 2;

// Yaw that turns an armor model's outer face, local +x, to its side. Local +z is the truck's right.
const SIDE_YAW: Record<SideLetter, number> = { F: 0, B: Math.PI, R: -Math.PI / 2, L: Math.PI / 2 };

// The frame is an upper and a lower steel rail on each outer deck edge, joined by one post per edge.
const RAIL = 0.06; // rail and post thickness in meters
const RAIL_H = 0.12; // rail height in meters

type Wheel = { mount: THREE.Group; spin: THREE.Object3D; restY: number };

// Where a model goes in body space.
type Placement = { pos: THREE.Vector3; yaw: number; scale: THREE.Vector3 };

// A model rebuilds only when this changes: chassis, faction, and every grid item with its place and damage state.
function signatureOf(v: Vehicle): string {
  const items = v.items
    .map((it) => {
      const what = it.kind === 'part' ? `${it.part.defId}#${it.part.id}:${it.part.hp > 0 ? 1 : 0}` : it.good;
      return `${what}@${it.x},${it.y},${it.rot}`;
    })
    .join(',');
  return `${v.chassisId}|${v.faction}|${items}`;
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
    const body = bodyOf(v.chassisId);
    const paint = FACTION_COLORS[v.faction].top;
    this.groundOffset = body.wheelRadius + T.suspensionRest;

    const still = new THREE.Group();
    this.buildFrame(v, body, still, paint);
    const wheelItems: PartItem[] = [];
    for (const item of v.items) {
      if (!onChassis(v, item)) continue;
      if (item.kind === 'good') {
        still.add(this.placeItem(v, body, item, paint));
        continue;
      }
      const def = partDef(item.part.defId);
      const mounted = isMounted(v.chassisId, item);
      if (def.id === 'wheel' && mounted) wheelItems.push(item);
      else if (def.id === 'wheel') still.add(this.spareWheel(v, body, item, paint));
      else if (def.kind === 'weapon') this.buildWeapon(v, body, item, mounted, still, paint);
      else if (def.kind === 'armor') still.add(this.placeArmor(v, body, item, paint));
      else still.add(this.placeItem(v, body, item, paint));
    }
    this.buildWheels(v, body, wheelItems, paint);
    this.root.add(mergeStatic(still));
  }

  // Rails along every deck edge that faces outside the grid or a wheel cell, under one deck tile per cell (IV5).
  // The rails reach the collider's outer faces, so the frame footprint is the collider footprint.
  private buildFrame(v: Vehicle, body: Body, into: THREE.Group, paint: number): void {
    const grid = baseGrid(v.chassisId);
    const wheels = wheelCells(v.chassisId);
    const solid = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < grid.w && y < grid.h && grid.cells[y][x] !== null && !wheels.has(`${x},${y}`);
    const top = body.half.y + socket('deck_tile', 'underside').y; // the socket sits below the deck top
    const bottom = -body.half.y;
    const steel = new THREE.MeshLambertMaterial({ color: PAL.metal, flatShading: true });
    const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number): void => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), steel);
      mesh.position.set(x, y, z);
      into.add(mesh);
    };
    const rail = (sx: number, sz: number, x: number, z: number): void => {
      box(sx, RAIL_H, sz, x, top - RAIL_H / 2, z);
      box(sx, RAIL_H, sz, x, bottom + RAIL_H / 2, z);
      box(RAIL, top - bottom, RAIL, x, (top + bottom) / 2, z);
    };
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        if (!solid(x, y)) continue;
        const c = cellCenter(v.chassisId, x, y);
        if (!solid(x, y - 1)) rail(RAIL, CELL.across, c.x + CELL.along / 2 - RAIL / 2, c.z);
        if (!solid(x, y + 1)) rail(RAIL, CELL.across, c.x - CELL.along / 2 + RAIL / 2, c.z);
        if (!solid(x - 1, y)) rail(CELL.along, RAIL, c.x, c.z - CELL.across / 2 + RAIL / 2);
        if (!solid(x + 1, y)) rail(CELL.along, RAIL, c.x, c.z + CELL.across / 2 - RAIL / 2);
        const tile = model('deck_tile');
        tile.position.set(c.x, body.half.y, c.z);
        tint(tile, paint, 1);
        into.add(tile);
      }
    }
  }

  // A part or good model on its cells' center, turned for rotation 1 and stretched to the turned footprint (PC1).
  private placeItem(v: Vehicle, body: Body, item: GridItem, paint: number): THREE.Object3D {
    const obj = model(itemModel(item));
    place(obj, footprint(v, body, item));
    tint(obj, paint, toneOf(item));
    return obj;
  }

  // Armor is authored as a front-edge row of N cells with its outer face at +x.
  // It turns to the side its cells lie on and stretches to their span. A spare armor part lies as a front or a left row.
  private placeArmor(v: Vehicle, body: Body, item: PartItem, paint: number): THREE.Object3D {
    const def = partDef(item.part.defId);
    const n = Math.max(def.w, def.h);
    const size = itemSize(item);
    const side = isMounted(v.chassisId, item) ? sideOf(v, item.part) : size.w >= size.h ? 'F' : 'L';
    if (!side) throw new Error(`Armor ${item.part.id} is mounted off a side letter`);
    const across = side === 'F' || side === 'B';
    const span = across ? size.w * CELL.across : size.h * CELL.along;
    const depthCells = across ? size.h : size.w;
    if (depthCells !== 1) throw new Error(`Armor ${item.part.id} is ${depthCells} cells deep on side ${side}, expected 1`);
    const depth = across ? CELL.along : CELL.across;
    const obj = model(partModel(def.id));
    const at = footprint(v, body, item);
    place(obj, { pos: at.pos, yaw: SIDE_YAW[side], scale: new THREE.Vector3(depth / CELL.along, 1, span / (n * CELL.across)) });
    tint(obj, paint, toneOf(item));
    return obj;
  }

  // The mount fills the footprint. The head keeps its authored size, sits at the mount's head socket and turns with aim.
  // The receiver is the head's origin, the barrel joins at its muzzle socket and the extra at its extra socket.
  private buildWeapon(v: Vehicle, body: Body, item: PartItem, active: boolean, still: THREE.Group, paint: number): void {
    const look = weaponLook(item.part.id, item.part.defId);
    const tone = toneOf(item);
    const at = footprint(v, body, item);
    const mount = model(look.mount);
    place(mount, at);
    tint(mount, paint, tone);
    still.add(mount);

    const parts = new THREE.Group();
    const receiver = model(look.receiver);
    parts.add(receiver);
    const barrel = model(look.barrel);
    barrel.position.copy(socket(look.receiver, 'muzzle'));
    parts.add(barrel);
    if (look.extra) {
      const extra = model(look.extra);
      extra.position.copy(socket(look.receiver, 'extra'));
      parts.add(extra);
    }
    for (const p of parts.children) tint(p, paint, tone);
    const head = mergeStatic(parts);
    mount.updateMatrix();
    head.position.copy(socket(look.mount, 'head').applyMatrix4(mount.matrix));
    if (!active) {
      still.add(head);
      return;
    }
    this.root.add(head);
    this.turrets.push(head);
  }

  // Wheels hang at the physics wheel mounts, scaled from the 1 m model to the look's radius and width.
  private buildWheels(v: Vehicle, body: Body, items: PartItem[], paint: number): void {
    const mounts = wheelMounts(body);
    if (items.length !== mounts.length) throw new Error(`${v.id} has ${items.length} mounted wheels, expected ${mounts.length}`);
    const tones = mounts.map((m) => {
      const item = items.find((it) => {
        const c = cellCenter(v.chassisId, it.x, it.y);
        return Math.abs(c.x - m.x) < 1e-6 && Math.abs(c.z - m.z) < 1e-6;
      });
      if (!item) throw new Error(`${v.id} has no wheel item at the wheel mount ${m.x},${m.z}`);
      return toneOf(item);
    });
    mounts.forEach((m, i) => {
      const mount = new THREE.Group();
      mount.position.set(m.x, m.y - T.suspensionRest, m.z);
      const spin = this.wheelModel(body, paint, tones[i]);
      mount.add(spin);
      this.root.add(mount);
      this.wheels.push({ mount, spin, restY: m.y });
    });
  }

  // A spare wheel stands on the deck at its cell.
  private spareWheel(v: Vehicle, body: Body, item: PartItem, paint: number): THREE.Object3D {
    const wheel = this.wheelModel(body, paint, toneOf(item));
    const at = footprint(v, body, item);
    wheel.position.set(at.pos.x, at.pos.y + body.wheelRadius, at.pos.z);
    return wheel;
  }

  private wheelModel(body: Body, paint: number, tone: number): THREE.Object3D {
    const raw = model('wheel');
    tint(raw, paint, tone);
    const wrap = new THREE.Group();
    wrap.add(raw);
    const wheel = mergeStatic(wrap);
    wheel.scale.set(body.wheelRadius, body.wheelRadius, body.wheelHalfWidth * 2);
    return wheel;
  }
}

// Rows past the chassis grid come from mounted cargo parts. The cargo model stands for them, so their items are not drawn.
function onChassis(v: Vehicle, item: GridItem): boolean {
  const grid = baseGrid(v.chassisId);
  const cells = itemCells(item);
  const inside = cells.filter((c) => c.y < grid.h).length;
  if (inside !== 0 && inside !== cells.length) throw new Error(`Item ${item.id} lies across the end of the ${v.chassisId} grid`);
  return inside === cells.length;
}

function wheelCells(chassisId: string): Set<string> {
  return new Set(chassisDef(chassisId).core.filter((c) => c.defId === 'wheel').map((c) => `${c.x},${c.y}`));
}

function itemModel(item: GridItem) {
  return partModel(item.kind === 'part' ? item.part.defId : item.good);
}

function toneOf(item: GridItem): number {
  if (item.kind === 'good' || item.part.hp > 0) return 1;
  return BROKEN_TONE[partDef(item.part.defId).kind];
}

// Center of an item's cells on the deck top, with the turn and base stretch for its rotation.
function footprint(v: Vehicle, body: Body, item: GridItem): Placement {
  const cells = itemCells(item);
  const first = cellCenter(v.chassisId, cells[0].x, cells[0].y);
  const last = cellCenter(v.chassisId, cells[cells.length - 1].x, cells[cells.length - 1].y);
  const pos = new THREE.Vector3((first.x + last.x) / 2, body.half.y, (first.z + last.z) / 2);
  if (item.rot === 0) return { pos, yaw: 0, scale: new THREE.Vector3(1, 1, 1) };
  return { pos, yaw: ROT_YAW, scale: new THREE.Vector3(CELL.across / CELL.along, 1, CELL.along / CELL.across) };
}

function place(obj: THREE.Object3D, at: Placement): void {
  obj.position.copy(at.pos);
  obj.rotation.set(0, at.yaw, 0);
  obj.scale.copy(at.scale);
}

// Paint materials take the faction color. A broken part darkens all its materials.
function tint(obj: THREE.Object3D, paint: number, tone: number): void {
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mat = o.material;
    if (!(mat instanceof THREE.MeshLambertMaterial)) throw new Error(`Part mesh ${o.name} has material ${mat.type}, expected one Lambert material`);
    if (mat.name === PAINT) mat.color.setHex(paint);
    mat.color.multiplyScalar(tone);
  });
}

// One mesh per material color for everything under group, in group space. The returned group has an identity transform.
function mergeStatic(group: THREE.Group): THREE.Group {
  group.updateMatrixWorld(true);
  const toGroup = group.matrixWorld.clone().invert();
  const byColor = new Map<number, THREE.BufferGeometry[]>();
  const used: THREE.Mesh[] = [];
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mat = o.material as THREE.MeshLambertMaterial;
    let geo = o.geometry.clone().applyMatrix4(toGroup.clone().multiply(o.matrixWorld));
    if (geo.index) geo = geo.toNonIndexed();
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
    geo.morphAttributes = {};
    geo.clearGroups();
    const hex = mat.color.getHex();
    const list = byColor.get(hex) ?? [];
    list.push(geo);
    byColor.set(hex, list);
    used.push(o);
  });
  const out = new THREE.Group();
  for (const [hex, geos] of byColor) {
    const merged = mergeGeometries(geos);
    if (!merged) throw new Error(`Could not merge ${geos.length} truck meshes of color ${hex.toString(16)}`);
    for (const g of geos) g.dispose();
    const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ color: hex, flatShading: true }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    out.add(mesh);
  }
  for (const m of used) {
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  }
  return out;
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
