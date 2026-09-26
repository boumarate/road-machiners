// Trucks drawn as car-shaped bodies of Blender pieces on the chassis grid, with every grid item's model on its own cells.
// Below the deck top, edge pieces close the physics collider box. Above it, the chassis zones build a hood, a closed cab and a bed.
// Items stand on the surface of their zone: the hood top, the cab roof or the bed floor.
// Body space: +x is the nose, +z the truck's right, +y up, origin at the collider center. Models share that frame.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { chassisDef, type Zone } from '../../data/chassis';
import { partDef, type PartKind } from '../../data/parts';
import { PHYSICS } from '../../data/physics';
import { wheelMounts } from '../../phys/body';
import { bodyOf, cellCenter, type Body } from '../../sim/body';
import { headingOf, headingQuat, type VehicleFrame } from '../../phys/frames';
import { FACTION_COLORS, PAL, shade } from '../../render/palette';
import { BODY_PARTS, partModel, weaponLook } from '../../render/partLooks';
import { baseGrid, isMounted, itemCells, itemSize, sideOf, type SideLetter } from '../../sim/grid';
import type { GridItem, Vehicle } from '../../sim/types';
import { model, socket, type ModelName } from './models';

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

// Body edge pieces are authored 1 m tall with their top on the deck top. They stretch to the chassis box height.
const EDGE_H = 1;
// The dark inner box stands this far behind the outer faces, inside the edge pieces' skins.
const CORE_INSET = 0.03;
// Behind a mounted plate the inner box steps back further, behind the plate's back face.
const ARMOR_INSET = 0.12;
// A bed's inner wall stops this far from each cell end, inside the side skin next to it.
const INNER_WALL_GAP = 0.02;
// The inner box shows inside the wheel wells.
const CORE_COLOR = shade(PAL.metal, 0.8);

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
    const onBody = v.items.filter((item) => onChassis(v, item));
    this.buildFrame(v, body, still, paint, FACTION_COLORS[v.faction].cab, coverOf(v, onBody));
    const wheelItems: PartItem[] = [];
    for (const item of onBody) {
      const surface = surfaceOf(v, body, item);
      if (item.kind === 'good') {
        still.add(this.placeItem(v, item, paint, surface));
        continue;
      }
      const def = partDef(item.part.defId);
      const mounted = isMounted(v.chassisId, item);
      // The cab core has no model: the cab zone draws the cab.
      if (BODY_PARTS.has(def.id)) continue;
      if (def.id === 'wheel' && mounted) wheelItems.push(item);
      else if (def.id === 'wheel') still.add(this.spareWheel(v, body, item, paint, surface));
      else if (def.kind === 'weapon') this.buildWeapon(v, item, mounted, still, paint, surface);
      else if (def.kind === 'armor') still.add(this.placeArmor(v, body, item, paint, mounted, surface));
      // Core parts sit on their zone's floor. An engine in the hood stands in the engine bay and shows through the cutout.
      else if (def.kind === 'core' || (def.kind === 'engine' && inZone(v, item, 'hood'))) still.add(this.placeItem(v, item, paint, floorOf(v, body, item)));
      else still.add(this.placeItem(v, item, paint, surface));
    }
    this.buildWheels(v, body, wheelItems, paint);
    this.root.add(mergeStatic(still));
  }

  // The body within the collider footprint (IV5). Only bumpers, fender flares and wheels reach past it.
  // The deck top is the beltline. Below it, edge pieces close the collider box on the cells' open faces: body_side on sides,
  // the nose with headlights at its ends and a bumper in front, the tail or the bed's tailgate and a bumper at the back.
  // Wheel cells get a fender with a painted box above it. A dark inner box fills each cell up to its zone's floor.
  // Above the beltline, hood cells get a low hood panel, open over an engine with a rim around the cutout.
  // Cab cells get the greenhouse: a roof, and a windshield, rear wall or side window on faces toward another zone or the outside.
  // Bed cells get a floor sunk below the beltline, so the body sides are the bed walls.
  // Mounted plate armor replaces the edge piece on its faces. A ram replaces the bumper on its cells.
  private buildFrame(v: Vehicle, body: Body, into: THREE.Group, paint: number, cabPaint: number, cover: Cover): void {
    const grid = baseGrid(v.chassisId);
    const wheels = wheelCells(v.chassisId);
    const zones = rowZones(v.chassisId);
    const inGrid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < grid.w && y < grid.h;
    const isCell = (x: number, y: number): boolean => inGrid(x, y) && grid.cells[y][x] !== null;
    const zoneAt = (x: number, y: number): Zone | null => (isCell(x, y) ? zones[y] : null);
    const top = body.half.y;
    const bottom = -body.half.y;
    const stretch = (top - bottom) / EDGE_H;
    const underside = top + socket('deck_tile', 'underside').y; // the socket sits below the deck top
    const floors: Record<Zone, number> = { hood: underside, cab: underside, bed: top + socket('bed_floor', 'underside').y };
    const bay = top + socket('hood_panel', 'bay').y;
    const coreMat = new THREE.MeshLambertMaterial({ color: CORE_COLOR, flatShading: true });
    const paintMat = new THREE.MeshLambertMaterial({ color: paint, flatShading: true });
    const box = (mat: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void => {
      if (x1 <= x0 || y1 <= y0 || z1 <= z0) throw new Error(`${v.chassisId} body box is empty: x ${x0}..${x1}, y ${y0}..${y1}, z ${z0}..${z1}`);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
      mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      into.add(mesh);
    };
    // A piece on the cell center at the deck top. height stretches local y, along stretches local x for a 0.65 m side piece on a 0.4 m face.
    const piece = (name: ModelName, c: { x: number; z: number }, yaw: number, height = 1, along = 1, color = paint): void => {
      const obj = model(name);
      place(obj, { pos: new THREE.Vector3(c.x, top, c.z), yaw, scale: new THREE.Vector3(along, height, 1) });
      tint(obj, color, 1);
      into.add(obj);
    };
    const shortSide = CELL.across / CELL.along;
    // A nose cell is a non-wheel cell on the front edge. Headlights go at the ends of each run of nose cells.
    const isNose = (x: number, y: number): boolean => isCell(x, y) && !inGrid(x, y - 1) && !wheels.has(`${x},${y}`);
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        if (!isCell(x, y)) continue;
        const c = cellCenter(v.chassisId, x, y);
        const zone = zones[y];
        const front = !isCell(x, y - 1);
        const back = !isCell(x, y + 1);
        const left = !isCell(x - 1, y);
        const right = !isCell(x + 1, y);
        const key = `${x},${y}`;
        const wheel = wheels.has(key);
        const engine = cover.engines.has(key);
        const plated = (side: SideLetter): boolean => cover.plates.has(`${key},${side}`);

        // Above the beltline.
        const openFront = zoneAt(x, y - 1) !== zone;
        const openBack = zoneAt(x, y + 1) !== zone;
        if (zone === 'hood' && !engine) {
          piece(front ? 'hood_front' : 'hood_panel', c, 0);
          // A rim on each edge that meets the engine cutout.
          const cut = (ex: number, ey: number): boolean => cover.engines.has(`${ex},${ey}`);
          if (cut(x, y - 1)) piece('hood_rim', c, -Math.PI / 2, 1, shortSide);
          if (cut(x, y + 1)) piece('hood_rim', c, Math.PI / 2, 1, shortSide);
          if (cut(x - 1, y)) piece('hood_rim', c, 0);
          if (cut(x + 1, y)) piece('hood_rim', c, Math.PI);
        } else if (zone === 'cab') {
          const cab = (name: ModelName, yaw: number): void => piece(name, c, yaw, 1, 1, cabPaint);
          cab(openFront ? 'cab_roof_front' : 'cab_roof', 0);
          const side = openFront ? 'cab_side_front' : 'cab_side';
          if (openFront) cab('cab_front', 0);
          if (openBack) cab('cab_back', Math.PI);
          if (left) cab(side, 0);
          if (right) cab(side, Math.PI);
        } else if (zone === 'bed') {
          // A wheel cell's fill box rises to the beltline inside the bed, like a wheel well.
          if (wheel) piece('deck_tile', c, 0);
          else piece('bed_floor', c, 0);
          // Painted inner walls where the bed meets another zone. They stop short of the side skins, so their ends never show outside.
          const inner = (CELL.across - 2 * INNER_WALL_GAP) / CELL.along;
          if (!wheel && openFront && !front) piece('body_side', c, -Math.PI / 2, stretch, inner);
          if (!wheel && openBack && !back) piece('body_side', c, Math.PI / 2, stretch, inner);
        }

        // Below the beltline.
        const x0 = c.x - CELL.along / 2;
        const x1 = c.x + CELL.along / 2;
        const z0 = c.z - CELL.across / 2;
        const z1 = c.z + CELL.across / 2;
        if (wheel) {
          const fender = this.fender(body, c, paint);
          into.add(fender.obj);
          if (fender.fillBottom >= underside) throw new Error(`${v.chassisId} fender reaches above the deck underside`);
          box(paintMat, x0, x1, fender.fillBottom, underside, z0, z1);
          continue;
        }
        if (front && !plated('F')) {
          if (inGrid(x, y - 1)) piece('body_side', c, -Math.PI / 2, stretch, shortSide);
          else {
            const l = !isNose(x - 1, y);
            const r = !isNose(x + 1, y);
            piece(l && !r ? 'nose_light_l' : r && !l ? 'nose_light_r' : 'nose', c, 0, stretch);
          }
        }
        if (front && !inGrid(x, y - 1) && !cover.rams.has(key)) piece('bumper_front', c, 0, stretch);
        if (back && !plated('B')) {
          if (inGrid(x, y + 1)) piece('body_side', c, Math.PI / 2, stretch, shortSide);
          else piece(zone === 'bed' ? 'tailgate' : 'tail', c, Math.PI, stretch);
        }
        if (back && !inGrid(x, y + 1) && !cover.rams.has(key)) piece('bumper_rear', c, Math.PI, stretch);
        if (left && !plated('L')) piece('body_side', c, 0, stretch);
        if (right && !plated('R')) piece('body_side', c, Math.PI, stretch);
        const inset = (open: boolean, side: SideLetter): number => (!open ? 0 : plated(side) ? ARMOR_INSET : CORE_INSET);
        const floor = engine ? bay : floors[zone];
        box(coreMat, x0 + inset(back, 'B'), x1 - inset(front, 'F'), bottom + CORE_INSET, floor, z0 + inset(left, 'L'), z1 - inset(right, 'R'));
      }
    }
  }

  // The arch hangs at the wheel's rest hub, scaled from the 1 m model to the look's wheel radius and width.
  // Its outer side faces the truck side the cell lies on. fillBottom is where the painted box above it starts.
  private fender(body: Body, c: { x: number; z: number }, paint: number): { obj: THREE.Object3D; fillBottom: number } {
    if (c.z === 0) throw new Error('A wheel cell sits on the center line, so its fender has no outer side');
    const hubY = body.wheelY - T.suspensionRest;
    const obj = model('fender');
    place(obj, {
      pos: new THREE.Vector3(c.x, hubY, c.z),
      yaw: c.z < 0 ? 0 : Math.PI,
      scale: new THREE.Vector3(body.wheelRadius, body.wheelRadius, body.wheelHalfWidth * 2),
    });
    tint(obj, paint, 1);
    return { obj, fillBottom: hubY + body.wheelRadius * socket('fender', 'top').y };
  }

  // A part or good model on its cells' center at height y, turned for rotation 1 and stretched to the turned footprint (PC1).
  private placeItem(v: Vehicle, item: GridItem, paint: number, y: number): THREE.Object3D {
    const obj = model(itemModel(item));
    place(obj, footprint(v, item, y));
    tint(obj, paint, toneOf(item));
    return obj;
  }

  // Armor is authored as a front-edge row of N cells with its outer face at +x.
  // It turns to the side its cells lie on and stretches to their span. A spare armor part lies as a front or a left row on the zone surface.
  // A mounted plate hangs from the beltline over the body side it replaces. A mounted ram hangs from the chassis bottom,
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

  // A spare wheel stands on its zone surface at its cell.
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

// Body pieces that items replace. Keys are "x,y" cells, and "x,y,side" for plate faces.
type Cover = { engines: Set<string>; plates: Set<string>; rams: Set<string> };

// Engines in the hood replace the hood panel on their cells. Mounted plate armor replaces the edge piece below the beltline on its side of its cells.
// A mounted ram replaces the bumper on its cells. Cages stand over the body and replace nothing.
function coverOf(v: Vehicle, items: GridItem[]): Cover {
  const cover: Cover = { engines: new Set(), plates: new Set(), rams: new Set() };
  for (const item of items) {
    if (item.kind !== 'part') continue;
    const def = partDef(item.part.defId);
    const cells = itemCells(item).map((c) => `${c.x},${c.y}`);
    if (def.kind === 'engine' && inZone(v, item, 'hood')) for (const c of cells) cover.engines.add(c);
    if (def.kind !== 'armor' || !isMounted(v.chassisId, item)) continue;
    const side = sideOf(v, item.part);
    if (!side) throw new Error(`Armor ${item.part.id} is mounted off a side letter`);
    if (def.look === 'plates') for (const c of cells) cover.plates.add(`${c},${side}`);
    if (def.look === 'ram') for (const c of cells) cover.rams.add(c);
  }
  return cover;
}

// The zone of each grid row.
function rowZones(chassisId: string): Zone[] {
  const def = chassisDef(chassisId);
  const zones = def.layout.map((_, y) => {
    const hit = (Object.entries(def.zones) as [Zone, [number, number]][]).filter(([, [a, b]]) => y >= a && y <= b);
    if (hit.length !== 1) throw new Error(`Chassis ${chassisId} row ${y} lies in ${hit.length} zones, expected 1`);
    return hit[0][0];
  });
  return zones;
}

function inZone(v: Vehicle, item: GridItem, zone: Zone): boolean {
  const zones = rowZones(v.chassisId);
  return itemCells(item).every((c) => zones[c.y] === zone);
}

// Where items stand in each zone, from the beltline: the hood top, the cab roof, and the sunk bed floor.
function zoneTop(zone: Zone): number {
  if (zone === 'hood') return socket('hood_panel', 'surface').y;
  if (zone === 'cab') return socket('cab_roof', 'surface').y;
  return socket('bed_floor', 'surface').y;
}

// Where core parts sit in each zone, from the beltline: the engine bay under the hood, the cab floor, and the bed floor.
function zoneFloor(zone: Zone): number {
  if (zone === 'hood') return socket('hood_panel', 'bay').y;
  if (zone === 'cab') return 0;
  return socket('bed_floor', 'surface').y;
}

function floorOf(v: Vehicle, body: Body, item: GridItem): number {
  const zones = rowZones(v.chassisId);
  return body.half.y + Math.max(...itemCells(item).map((c) => zoneFloor(zones[c.y])));
}

// An item across two zones stands on the higher surface, so it never sinks into the body.
function surfaceOf(v: Vehicle, body: Body, item: GridItem): number {
  const zones = rowZones(v.chassisId);
  return body.half.y + Math.max(...itemCells(item).map((c) => zoneTop(zones[c.y])));
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

// Center of an item's cells at height y, with the turn and base stretch for its rotation.
function footprint(v: Vehicle, item: GridItem, y: number): Placement {
  const cells = itemCells(item);
  const first = cellCenter(v.chassisId, cells[0].x, cells[0].y);
  const last = cellCenter(v.chassisId, cells[cells.length - 1].x, cells[cells.length - 1].y);
  const pos = new THREE.Vector3((first.x + last.x) / 2, y, (first.z + last.z) / 2);
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
