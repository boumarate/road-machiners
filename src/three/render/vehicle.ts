// Trucks drawn as one base model per chassis, with every grid item's model from the shared kit on its own cells.
// Items stand on the base's row surfaces. Core parts and engines on their mounts stand lower, on its floor levels.
// Body space: +x is the nose, +z the truck's right, +y up, origin at the collider center. Models share that frame.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { partDef, type PartKind } from '../../data/parts';
import { PHYSICS } from '../../data/physics';
import { wheelMounts } from '../../phys/body';
import { bodyOf, cellCenter, type Body } from '../../sim/body';
import { headingOf, headingQuat, type VehicleFrame } from '../../phys/frames';
import { FACTION_COLORS, PAL } from '../../render/palette';
import { BODY_PARTS, baseModel, partModel, weaponLook } from '../../render/partLooks';
import { baseGrid, isMounted, itemCells, itemSize, sideOf, type SideLetter } from '../../sim/grid';
import type { GridItem, Vehicle } from '../../sim/types';
import { model, socket, type ModelName } from './models';

const T = PHYSICS.truck;
const CELL = PHYSICS.cell;


type PartItem = Extract<GridItem, { kind: 'part' }>;

// Material name that takes the faction color.
const PAINT = 'paint';
const LAMP = 'light'; // the headlight face material in the nose and base models
const TRIM = 'trim'; // base material that takes the faction cab color
const FIT_SLACK = 1e-3; // meters a base may pass its footprint by float noise

// Color factor for every material of a broken part.
const BROKEN_TONE: Record<PartKind, number> = { weapon: 0.5, armor: 0.6, engine: 0.6, cargo: 0.6, core: 0.6, scanner: 0.6 };

// Yaw for rotation 1. Local +x, the model's front, turns to the truck's left.
const ROT_YAW = Math.PI / 2;

// Yaw that turns an armor model's outer face, local +x, to its side. Local +z is the truck's right.
const SIDE_YAW: Record<SideLetter, number> = { F: 0, B: Math.PI, R: -Math.PI / 2, L: Math.PI / 2 };

// Bumpers are authored 1 m tall with their top on the deck top. They stretch to the chassis box height plus the skirt.
const EDGE_H = 1;
const SKIRT = 0.22; // meters a base hangs below the collider, SKIRT in tools/blender/parts_common_base.py

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

  private sig = '';
  private wheels: Wheel[] = [];
  private turrets: THREE.Group[] = [];
  private heading = 0;
  private lampMat = new THREE.MeshBasicMaterial({ color: PAL.lamp.off });

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
  }

  lamps(on: boolean): void {
    this.lampMat.color.setHex(on ? PAL.lamp.on : PAL.lamp.off);
  }

  // yaw is a map-space heading (radians, 0 = +x). null points turrets forward.
  aim(yaw: number | null): void {
    const delta = yaw === null ? 0 : yaw - this.heading;
    const q = headingQuat(delta);
    for (const turret of this.turrets) turret.quaternion.set(q.x, q.y, q.z, q.w);
  }

  dispose(): void {
    disposeChildren(this.root);
  }

  private rebuild(v: Vehicle): void {
    disposeChildren(this.root);
    this.wheels = [];
    this.turrets = [];
    const body = bodyOf(v.chassisId);
    const paint = FACTION_COLORS[v.faction].top;
    // disposeChildren disposed the lamp material, so a new one keeps the lamp state.
    const on = this.lampMat.color.getHex() === PAL.lamp.on;
    this.lampMat = new THREE.MeshBasicMaterial({ color: on ? PAL.lamp.on : PAL.lamp.off });

    const still = new THREE.Group();
    const onBody = v.items.filter((item) => onChassis(v, item));
    const base = baseModel(v.chassisId);
    this.buildBase(v, body, base, still, paint, FACTION_COLORS[v.faction].cab, ramCells(v, onBody));
    const wheelItems: PartItem[] = [];
    for (const item of onBody) {
      const surface = baseLevel(base, item, 'row');
      if (item.kind === 'good') {
        still.add(this.placeItem(v, item, paint, surface));
        continue;
      }
      const def = partDef(item.part.defId);
      const mounted = isMounted(v.chassisId, item);
      // The cab core has no model: the base draws the cab.
      if (BODY_PARTS.has(def.id)) continue;
      if (def.id === 'wheel' && mounted) wheelItems.push(item);
      else if (def.id === 'wheel') still.add(this.spareWheel(v, body, item, paint, surface));
      else if (def.kind === 'weapon') this.buildWeapon(v, item, mounted, still, paint, this.riser(v, item, baseTop(v, base), surface, paint, still));
      else if (def.kind === 'armor') still.add(this.placeArmor(v, body, item, paint, mounted, surface));
      // Core parts sit on the floor. An engine on its mount stands in the engine bay and shows through the cutout.
      else if (def.kind === 'core' || (def.kind === 'engine' && mounted)) still.add(this.placeItem(v, item, paint, baseLevel(base, item, 'floor')));
      else still.add(this.placeItem(v, item, paint, surface));
    }
    this.buildWheels(v, body, wheelItems, paint);
    this.root.add(mergeStatic(still));
  }

  // Headlight faces share the lamp material, so lamps() switches them all.
  private useLamp(obj: THREE.Object3D): void {
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material.name === LAMP) {
        o.material.dispose();
        o.material = this.lampMat;
        o.userData.lamp = true;
      }
    });
  }

  // The chassis base model at the collider center, and kit bumpers on its front and back row cells unless a ram covers them.
  private buildBase(v: Vehicle, body: Body, name: ModelName, into: THREE.Group, paint: number, trim: number, rams: Set<string>): void {
    const obj = model(name);
    checkBaseFits(v.chassisId, body, obj);
    tint(obj, paint, 1);
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material.name === TRIM) o.material.color.setHex(trim);
    });
    this.useLamp(obj);
    into.add(obj);
    const grid = baseGrid(v.chassisId);
    const stretch = (2 * body.half.y + SKIRT) / EDGE_H; // bumpers hang to the skirt bottom
    const ends: [number, ModelName, number][] = [[0, 'bumper_front', 0], [grid.h - 1, 'bumper_rear', Math.PI]];
    for (const [y, bumperName, yaw] of ends) {
      for (let x = 0; x < grid.w; x++) {
        if (grid.cells[y][x] === null || rams.has(`${x},${y}`)) continue;
        const c = cellCenter(v.chassisId, x, y);
        const bumper = model(bumperName);
        place(bumper, { pos: new THREE.Vector3(c.x, body.half.y, c.z), yaw, scale: new THREE.Vector3(1, stretch, 1) });
        tint(bumper, paint, 1);
        into.add(bumper);
      }
    }
  }

  // A part or good model on its cells' center at height y, turned for rotation 1 and stretched to the turned footprint (PC1).
  private placeItem(v: Vehicle, item: GridItem, paint: number, y: number): THREE.Object3D {
    const obj = model(itemModel(item));
    place(obj, footprint(v, item, y));
    tint(obj, paint, toneOf(item));
    return obj;
  }

  // Armor is authored as a front-edge row of N cells with its outer face at +x.
  // It turns to the side its cells lie on and stretches to their span. A spare armor part lies as a front or a left row on its row surface.
  // A mounted plate hangs from the deck top over the base side. A mounted ram hangs from the chassis bottom,
  // in the bumper's place. A mounted cage stands on the beltline over the body.
  private placeArmor(v: Vehicle, body: Body, item: PartItem, paint: number, mounted: boolean, surface: number): THREE.Object3D {
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
    if (def.kind !== 'armor') throw new Error(`Part ${def.id} is not armor`);
    const obj = model(partModel(def.id));
    const height = new THREE.Box3().setFromObject(obj).max.y;
    const hung = { plates: body.half.y - height, ram: -body.half.y, cage: body.half.y }[def.look];
    const at = footprint(v, item, mounted ? hung : surface);
    place(obj, { pos: at.pos, yaw: SIDE_YAW[side], scale: new THREE.Vector3(depth / CELL.along, 1, span / (n * CELL.across)) });
    tint(obj, paint, toneOf(item));
    return obj;
  }

  // A weapon standing below the base top gets a riser post up to it, so its turret clears the cab when it turns.
  // Returns the height the weapon mount stands on.
  private riser(v: Vehicle, item: PartItem, clear: number, y: number, paint: number, into: THREE.Group): number {
    if (y >= clear) return y;
    const post = model('wmount_riser');
    const at = footprint(v, item, y);
    place(post, { pos: at.pos, yaw: 0, scale: new THREE.Vector3(1, (clear - y) / socket('wmount_riser', 'top').y, 1) });
    tint(post, paint, toneOf(item));
    into.add(post);
    return clear;
  }

  // The mount fills the footprint. The head keeps its authored size, sits at the mount's head socket and turns with aim.
  // The receiver is the head's origin, the barrel joins at its muzzle socket and the extra at its extra socket.
  private buildWeapon(v: Vehicle, item: PartItem, active: boolean, still: THREE.Group, paint: number, y: number): void {
    const look = weaponLook(item.part.id, item.part.defId);
    const tone = toneOf(item);
    const at = footprint(v, item, y);
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

  // A spare wheel stands on its row surface at its cell.
  private spareWheel(v: Vehicle, body: Body, item: PartItem, paint: number, y: number): THREE.Object3D {
    const wheel = this.wheelModel(body, paint, toneOf(item));
    const at = footprint(v, item, y);
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

// Cells of mounted rams, which replace the bumper there.
function ramCells(v: Vehicle, items: GridItem[]): Set<string> {
  const rams = new Set<string>();
  for (const item of items) {
    if (item.kind !== 'part' || !isMounted(v.chassisId, item)) continue;
    const def = partDef(item.part.defId);
    if (def.kind === 'armor' && def.look === 'ram') for (const c of itemCells(item)) rams.add(`${c.x},${c.y}`);
  }
  return rams;
}

// A base model's level under an item: the highest row or floor socket over its rows, in body meters.
function baseLevel(base: ModelName, item: GridItem, level: 'row' | 'floor'): number {
  return Math.max(...itemCells(item).map((c) => socket(base, `${level}${c.y}`).y));
}

// The front edge of the surface under an item: the rearmost row socket x over its rows, in body meters.
function baseFront(base: ModelName, item: GridItem): number {
  return Math.min(...itemCells(item).map((c) => socket(base, `row${c.y}`).x));
}

// The highest row surface of a base, in body meters: the cab roof on a pickup.
function baseTop(v: Vehicle, base: ModelName): number {
  return Math.max(...baseGrid(v.chassisId).cells.map((_, y) => socket(base, `row${y}`).y));
}

// A base fills its chassis footprint in length and width, so the drawn truck matches its collider.
function checkBaseFits(chassisId: string, body: Body, obj: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(obj);
  const out = box.min.x < -body.half.x - FIT_SLACK || box.max.x > body.half.x + FIT_SLACK || box.min.z < -body.half.z - FIT_SLACK || box.max.z > body.half.z + FIT_SLACK;
  if (out) throw new Error(`${chassisId} base spans x ${box.min.x.toFixed(3)}..${box.max.x.toFixed(3)}, z ${box.min.z.toFixed(3)}..${box.max.z.toFixed(3)}, past its footprint ${body.half.x} by ${body.half.z}`);
}

function itemModel(item: GridItem) {
  return partModel(item.kind === 'part' ? item.part.defId : item.good);
}

function toneOf(item: GridItem): number {
  if (item.kind === 'good' || item.part.hp > 0) return 1;
  return BROKEN_TONE[partDef(item.part.defId).kind];
}

// Center of an item's cells at height y, with the turn and base stretch for its rotation.
// An item standing on a row surface moves back until its front edge is behind the surface's front edge, so it never overhangs a raked windshield.
function footprint(v: Vehicle, item: GridItem, y: number): Placement {
  const cells = itemCells(item);
  const first = cellCenter(v.chassisId, cells[0].x, cells[0].y);
  const last = cellCenter(v.chassisId, cells[cells.length - 1].x, cells[cells.length - 1].y);
  const pos = new THREE.Vector3((first.x + last.x) / 2, y, (first.z + last.z) / 2);
  const base = baseModel(v.chassisId);
  const halfLength = (itemSize(item).h * CELL.along) / 2;
  if (y === baseLevel(base, item, 'row')) pos.x -= Math.max(0, pos.x + halfLength - baseFront(base, item));
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
// A mirrored mesh turns its triangles inside out. Swapping two corners of each triangle turns them back.
function flipWinding(geo: THREE.BufferGeometry): void {
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.getAttribute(name) as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i += 3) {
      for (let k = 0; k < a.itemSize; k++) {
        const one = a.array[(i + 1) * a.itemSize + k];
        a.array[(i + 1) * a.itemSize + k] = a.array[(i + 2) * a.itemSize + k];
        a.array[(i + 2) * a.itemSize + k] = one;
      }
    }
    a.needsUpdate = true;
  }
}

function mergeStatic(group: THREE.Group): THREE.Group {
  group.updateMatrixWorld(true);
  const toGroup = group.matrixWorld.clone().invert();
  const byColor = new Map<number, THREE.BufferGeometry[]>();
  const used: THREE.Mesh[] = [];
  const lamps: THREE.Mesh[] = [];
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (o.userData.lamp) {
      lamps.push(o);
      return;
    }
    const mat = o.material as THREE.MeshLambertMaterial;
    const toHere = toGroup.clone().multiply(o.matrixWorld);
    let geo = o.geometry.clone().applyMatrix4(toHere);
    if (geo.index) geo = geo.toNonIndexed();
    if (toHere.determinant() < 0) flipWinding(geo);
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
  // Lamp meshes keep their shared material, so they stay separate meshes.
  for (const lamp of lamps) {
    const toHere = toGroup.clone().multiply(lamp.matrixWorld);
    const geo = lamp.geometry.clone().applyMatrix4(toHere);
    if (toHere.determinant() < 0) flipWinding(geo);
    lamp.geometry.dispose();
    out.add(new THREE.Mesh(geo, lamp.material));
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
