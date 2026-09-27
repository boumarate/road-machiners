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
import { BASE_MODELS, BODY_PARTS, partModel, weaponLook } from '../../render/partLooks';
import { baseGrid, isMounted, itemCells, itemSize, sideOf, type SideLetter } from '../../sim/grid';
import type { GridItem, Vehicle } from '../../sim/types';
import { model, socket, type ModelName } from './models';

const S = PHYSICS.metersPerTile;
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

// Body edge pieces are authored 1 m tall with their top on the deck top. They stretch to the chassis box height.
const EDGE_H = 1;
// The dark inner box stands this far behind the outer faces, inside the edge pieces' skins.
const CORE_INSET = 0.03;
// Behind a mounted plate the inner box steps back further, behind the plate's back face.
const ARMOR_INSET = 0.12;
// A bed's inner wall stops this far from each cell end, inside the side skin next to it.
const WELL_CLEARANCE = 0.08; // meters between a bed wheel's rest top and its hump
const SKIRT = 0.22; // meters the painted skirt hangs below the collider, so the wheels tuck into arches in the body
const SKIRT_SKIN = 0.03; // skirt thickness
const ARCH_CLEARANCE = 0.06; // meters between a wheel and its arch in the skirt
const ARCH_SEGMENTS = 6; // straight edges along each side of an arch, for the low-poly look
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
    const base = BASE_MODELS[v.chassisId];
    if (base) this.buildBase(v, body, base, still, paint, FACTION_COLORS[v.faction].cab, coverOf(v, onBody));
    else this.buildFrame(v, body, still, paint, FACTION_COLORS[v.faction].cab, coverOf(v, onBody));
    const wheelItems: PartItem[] = [];
    for (const item of onBody) {
      const surface = base ? baseLevel(base, item, 'row') : surfaceOf(v, body, item);
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
      else if (def.kind === 'weapon') this.buildWeapon(v, item, mounted, still, paint, this.riser(v, item, base ? baseTop(v, base) : body.half.y + zoneTop('cab'), surface, paint, still));
      else if (def.kind === 'armor') still.add(this.placeArmor(v, body, item, paint, mounted, surface));
      // Core parts sit on the floor. An engine on its mount stands in the engine bay and shows through the cutout.
      else if (base && (def.kind === 'core' || (def.kind === 'engine' && mounted))) still.add(this.placeItem(v, item, paint, baseLevel(base, item, 'floor')));
      else if (!base && (def.kind === 'core' || (def.kind === 'engine' && inZone(v, item, 'hood')))) still.add(this.placeItem(v, item, paint, floorOf(v, body, item)));
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
  private buildBase(v: Vehicle, body: Body, name: ModelName, into: THREE.Group, paint: number, trim: number, cover: Cover): void {
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
        if (grid.cells[y][x] === null || cover.rams.has(`${x},${y}`)) continue;
        const c = cellCenter(v.chassisId, x, y);
        const bumper = model(bumperName);
        place(bumper, { pos: new THREE.Vector3(c.x, body.half.y, c.z), yaw, scale: new THREE.Vector3(1, stretch, 1) });
        tint(bumper, paint, 1);
        into.add(bumper);
      }
    }
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
    const skirtStretch = (top - bottom + SKIRT) / EDGE_H; // bumpers hang to the skirt bottom
    const underside = top + socket('deck_tile', 'underside').y; // the socket sits below the deck top
    const floors: Record<Zone, number> = { hood: underside, cab: underside, bed: top + socket('bed_floor', 'underside').y };
    const bay = top + socket('hood_panel', 'bay').y;
    // A bed wheel cell rises only as a hump over its wheel, from the bed floor up to just above the wheel top.
    const wellTop = Math.min(underside, Math.max(floors.bed, body.wheelY - T.suspensionRest + body.wheelRadius + WELL_CLEARANCE));
    const coreMat = new THREE.MeshLambertMaterial({ color: CORE_COLOR, flatShading: true });
    const paintMat = new THREE.MeshLambertMaterial({ color: paint, flatShading: true });
    const box = (mat: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void => {
      if (x1 <= x0 || y1 <= y0 || z1 <= z0) throw new Error(`${v.chassisId} body box is empty: x ${x0}..${x1}, y ${y0}..${y1}, z ${z0}..${z1}`);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
      mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      into.add(mesh);
    };
    // A piece on the cell center at the deck top. height stretches local y, along stretches local x for a 0.65 m side piece on a 0.4 m face.
    // mirror flips a left-side piece onto the right side, so its front stays at the front. A half turn would swap front and back.
    const piece = (name: ModelName, c: { x: number; z: number }, yaw: number, height = 1, along = 1, color = paint, mirror = false): void => {
      const obj = model(name);
      place(obj, { pos: new THREE.Vector3(c.x, top, c.z), yaw, scale: new THREE.Vector3(along, height, mirror ? -1 : 1) });
      tint(obj, color, 1);
      this.useLamp(obj);
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
        const sideModel: ModelName = zone === 'cab' ? 'door_side' : zone === 'bed' ? 'bed_side' : 'body_side';

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
          const cab = (name: ModelName, yaw: number, mirror = false): void => piece(name, c, yaw, 1, 1, cabPaint, mirror);
          cab(openFront ? 'cab_roof_front' : 'cab_roof', 0);
          const side = openFront ? 'cab_side_front' : 'cab_side';
          if (openFront) cab('cab_front', 0);
          if (openBack) cab('cab_back', Math.PI);
          if (left) cab(side, 0);
          if (right) cab(side, 0, true);
        } else if (zone === 'bed') {
          // A wheel cell under the bed floor keeps the floor. A taller wheel gets the hump from the fill box below.
          if (!wheel || wellTop === floors.bed) piece('bed_floor', c, 0);
          // Painted inner walls where the bed meets another zone. They stop short of the side skins, so their ends never show outside.
          const inner = (CELL.across - 2 * INNER_WALL_GAP) / CELL.along;
          if (!wheel && openFront && !front) piece('body_side', c, -Math.PI / 2, stretch, inner);
          if (!wheel && openBack && !back) piece('body_side', c, Math.PI / 2, stretch, inner);
        }

        // The hood flares out past the body sides, so the front reads wider than the cab.
        if (zone === 'hood' && left) piece('hood_flare', c, 0);
        if (zone === 'hood' && right) piece('hood_flare', c, 0, 1, 1, paint, true);

        // Below the beltline.
        const x0 = c.x - CELL.along / 2;
        const x1 = c.x + CELL.along / 2;
        const z0 = c.z - CELL.across / 2;
        const z1 = c.z + CELL.across / 2;
        if (wheel) {
          const fender = this.fender(body, c, paint);
          into.add(fender.obj);
          if (fender.fillBottom >= underside) throw new Error(`${v.chassisId} fender reaches above the deck underside`);
          box(paintMat, x0, x1, fender.fillBottom, zone === 'bed' ? wellTop : underside, z0, z1);
          // The bumpers run across the wheel corners too, so they span the full width.
          if (front && !inGrid(x, y - 1) && !cover.rams.has(key)) piece('bumper_front', c, 0, skirtStretch);
          if (back && !inGrid(x, y + 1) && !cover.rams.has(key)) piece('bumper_rear', c, Math.PI, skirtStretch);
          // Above a bed wheel's hump, short body sides keep the bed walls closed on the cell's open faces.
          if (zone === 'bed' && wellTop < top) {
            const wall = (top - wellTop) / EDGE_H;
            if (left) piece(sideModel, c, 0, wall);
            if (right) piece(sideModel, c, 0, wall, 1, paint, true);
            if (front) piece('body_side', c, -Math.PI / 2, wall, shortSide);
            if (back) piece('body_side', c, Math.PI / 2, wall, shortSide);
          }
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
        if (front && !inGrid(x, y - 1) && !cover.rams.has(key)) piece('bumper_front', c, 0, skirtStretch);
        if (back && !plated('B')) {
          if (inGrid(x, y + 1)) piece('body_side', c, Math.PI / 2, stretch, shortSide);
          else piece(zone === 'bed' ? 'tailgate' : 'tail', c, Math.PI, stretch);
        }
        if (back && !inGrid(x, y + 1) && !cover.rams.has(key)) piece('bumper_rear', c, Math.PI, skirtStretch);
        if (left && !plated('L')) piece(sideModel, c, 0, stretch);
        if (right && !plated('R')) piece(sideModel, c, 0, stretch, 1, paint, true);
        const inset = (open: boolean, side: SideLetter): number => (!open ? 0 : plated(side) ? ARMOR_INSET : CORE_INSET);
        const floor = engine ? bay : floors[zone];
        box(coreMat, x0 + inset(back, 'B'), x1 - inset(front, 'F'), bottom + CORE_INSET, floor, z0 + inset(left, 'L'), z1 - inset(right, 'R'));
      }
    }
    this.buildSkirt(body, into, paintMat);
  }

  // A painted skirt below the collider on all four faces. The side skirts break at an arch around each wheel,
  // so the wheels sit inside the body line like on a real truck. Physics is unchanged: the skirt hangs below the collider box.
  private buildSkirt(body: Body, into: THREE.Group, mat: THREE.Material): void {
    const y1 = -body.half.y;
    const y0 = y1 - SKIRT;
    const hub = body.wheelY - T.suspensionRest;
    const r = body.wheelRadius + ARCH_CLEARANCE;
    // Half width of the arch at height y, zero where the arch no longer reaches.
    const halfArch = (y: number): number => Math.sqrt(Math.max(0, r * r - (y - hub) * (y - hub)));
    for (const sign of [-1, 1]) {
      const wheels = wheelMounts(body).filter((m) => Math.sign(m.z) === sign).map((m) => m.x).sort((a, b) => a - b);
      // Solid runs of skirt between the arches, each bounded by the arch curves at its ends.
      const ends = [-body.half.x, ...wheels.flatMap((x) => [x, x]), body.half.x];
      for (let i = 0; i < ends.length; i += 2) {
        const [from, to] = [ends[i], ends[i + 1]];
        const shape = new THREE.Shape();
        const edge = (x: number, dir: number, up: boolean): [number, number][] => {
          if (Math.abs(x) === body.half.x) return up ? [[x, y0], [x, y1]] : [[x, y1], [x, y0]];
          const pts: [number, number][] = [];
          for (let k = 0; k <= ARCH_SEGMENTS; k++) {
            const y = y0 + ((y1 - y0) * k) / ARCH_SEGMENTS;
            pts.push([x + dir * halfArch(y), y]);
          }
          return up ? pts : pts.reverse();
        };
        const pts = [...edge(from, 1, true), ...edge(to, -1, false)];
        if (pts[pts.length - 1][0] - pts[0][0] <= 0) continue;
        shape.moveTo(pts[0][0], pts[0][1]);
        for (const [x, y] of pts.slice(1)) shape.lineTo(x, y);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: SKIRT_SKIN, bevelEnabled: false });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.z = sign < 0 ? -body.half.z : body.half.z - SKIRT_SKIN;
        into.add(mesh);
      }
    }
    for (const sign of [-1, 1]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(SKIRT_SKIN, SKIRT, body.half.z * 2), mat);
      mesh.position.set(sign * (body.half.x - SKIRT_SKIN / 2), (y0 + y1) / 2, 0);
      into.add(mesh);
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

// Body x of the cab roof's front edge.
function roofFrontEdge(v: Vehicle): number {
  const frontRow = rowZones(v.chassisId).indexOf('cab');
  return cellCenter(v.chassisId, 0, frontRow).x + socket('cab_roof_front', 'front_edge').x;
}

// A base model's level under an item: the highest row or floor socket over its rows, in body meters.
function baseLevel(base: ModelName, item: GridItem, level: 'row' | 'floor'): number {
  return Math.max(...itemCells(item).map((c) => socket(base, `${level}${c.y}`).y));
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
// An item standing on the cab roof moves back until its front edge is on the roof, behind the raked windshield.
function footprint(v: Vehicle, item: GridItem, y: number): Placement {
  const cells = itemCells(item);
  const first = cellCenter(v.chassisId, cells[0].x, cells[0].y);
  const last = cellCenter(v.chassisId, cells[cells.length - 1].x, cells[cells.length - 1].y);
  const pos = new THREE.Vector3((first.x + last.x) / 2, y, (first.z + last.z) / 2);
  if (!BASE_MODELS[v.chassisId] && y === bodyOf(v.chassisId).half.y + zoneTop('cab')) pos.x -= Math.max(0, pos.x + (itemSize(item).h * CELL.along) / 2 - roofFrontEdge(v));
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
