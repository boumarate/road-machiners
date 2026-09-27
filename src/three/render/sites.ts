// Town and location models. Buildings that block movement are obstacles already (see obstacles.ts),
// so nothing here blocks. Blender models come from tools/blender/; each script's docstring gives its size.

import * as THREE from 'three';
import { REGION, type LocationDef, type TownDef } from '../../data/region';
import { TERRAIN } from '../../data/terrain';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { hash2 } from '../../render/noise';
import { siteGates } from '../../sim/sites';
import { BRIDGE_AXIS, BRIDGE_LENGTH } from '../../sim/bridge';
import { deckEnds, heightAt, type Terrain } from '../../sim/terrain';
import { angleDiff, segmentDist } from '../../sim/vec';
import { instancedModel, model, type ModelName } from './models';
import type { RenderScope } from './scope';

const S = PHYSICS.metersPerTile;
type Site = TownDef | LocationDef;
// Scales that fit ship models to the Icarus footprint: a 272 m Fallen Sun hull from the 26 m model, and
// Nose's 48 m bow from the 12 m cone.
const HULL_SCALE = 272 / 26;
const NOSE_SCALE = 4;
// The bridge model's 32 m by 7 m deck is stretched to the sim deck. Its trusses stand 2.4 m over the
// deck before this height scale.
const BRIDGE_RISE = 1.5;
const BRIDGE_DECK_TOP = 0.8; // meters from the model origin up to its deck top, before scaling

// Site props stay within the site's collision footprint. Every prop is grounded independently.
class SiteBuilder {
  readonly root = new THREE.Group();
  private readonly materials = new Map<number, THREE.MeshLambertMaterial>();
  constructor(private readonly terrain: Terrain, readonly site: Site) {
    this.root.name = `landmark-${site.id}`;
  }
  groundAt(x: number, z: number): number {
    return heightAt(this.terrain, this.site.pos.x + x, this.site.pos.y + z);
  }
  addShape(geometry: THREE.BufferGeometry, color: number, x: number, z: number, lift: number, yaw = 0): THREE.Mesh {
    let material = this.materials.get(color);
    if (!material) {
      material = new THREE.MeshLambertMaterial({ color, flatShading: true });
      this.materials.set(color, material);
    }
    const mesh = new THREE.Mesh(geometry, material);
    const wx = this.site.pos.x + x;
    const wz = this.site.pos.y + z;
    mesh.position.set(wx * S, (heightAt(this.terrain, wx, wz) + lift) * S, wz * S);
    mesh.rotation.y = yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    return mesh;
  }
  addBox(x: number, z: number, w: number, h: number, d: number, color: number, lift = 0, yaw = 0): THREE.Mesh {
    return this.addShape(new THREE.BoxGeometry(w * S, h * S, d * S), color, x, z, lift + h / 2, yaw);
  }
  addTank(x: number, z: number, radius: number, height: number, color: number, lift = 0): void {
    this.addShape(new THREE.CylinderGeometry(radius * S, radius * S, height * S, 10), color, x, z, lift + height / 2);
  }
  // A Blender model standing on the ground at site offset (x, z), turned by yaw radians.
  addModel(name: ModelName, x: number, z: number, yaw = 0, scale: number | THREE.Vector3 = 1, lift = 0): THREE.Object3D {
    const wx = this.site.pos.x + x;
    const wz = this.site.pos.y + z;
    const obj = model(name);
    obj.position.set(wx * S, (heightAt(this.terrain, wx, wz) + lift) * S, wz * S);
    obj.rotation.y = yaw;
    if (typeof scale === 'number') obj.scale.setScalar(scale);
    else obj.scale.copy(scale);
    this.root.add(obj);
    return obj;
  }
  // Many copies of one Blender model, each on the ground at its site offset, as instanced meshes.
  addInstances(name: ModelName, spots: { x: number; z: number; yaw: number }[]): void {
    const placements = spots.map(({ x, z, yaw }) => {
      const wx = this.site.pos.x + x;
      const wz = this.site.pos.y + z;
      const pos = new THREE.Vector3(wx * S, heightAt(this.terrain, wx, wz) * S, wz * S);
      return new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(UP, yaw), new THREE.Vector3(1, 1, 1));
    });
    this.root.add(instancedModel(name, placements, placements.map(() => 1)));
  }
  // A site offset that must stay off every road, or the model would stand in traffic.
  offRoad(x: number, z: number, clearance: number): void {
    const pos = { x: this.site.pos.x + x, y: this.site.pos.y + z };
    if (REGION.roads.some((road) => road.some((point, i) => i > 0 && segmentDist(pos, road[i - 1], point) < REGION.roadWidth / 2 + clearance))) {
      throw new Error(`Site prop at ${x},${z} of ${this.site.id} stands on a road`);
    }
  }
  // A dead orchard tree: bare trunk, two branches and a fallen limb.
  addDeadTree(x: number, z: number, index: number): void {
    const lean = (hash2(index, 19) - 0.5) * 0.35;
    const trunk = this.addBox(x, z, 0.16, 1.5, 0.18, PAL.trunk);
    trunk.rotation.z = lean;
    for (const sign of [-1, 1]) {
      const branch = this.addBox(x + sign * 0.24, z, 0.1, 0.95, 0.12, PAL.trunk, 0.85);
      branch.rotation.z = sign * 0.75;
    }
    this.addBox(x + 0.35, z, 0.7, 0.13, 0.18, PAL.trunk, 0.03, lean);
  }
  addRuin(x: number, z: number, width: number, depth: number): void {
    this.addBox(x, z, width, 0.12, depth, PAL.wall.dark);
    this.addBox(x - width / 2, z, 0.2, 1.2, depth, PAL.wall.side);
    this.addBox(x, z - depth / 2, width, 0.85, 0.2, PAL.wall.top);
    this.addBox(x + width / 2, z - depth / 3, 0.2, 0.55, depth / 3, PAL.wall.side);
    this.addBox(x + 0.3, z + 0.3, width * 0.7, 0.12, depth * 0.8, PAL.rust.top, 0.08, 0.35);
  }
  addHull(x: number, z: number, length: number, width: number, yaw: number): void {
    this.addBox(x, z, length, 0.3, width, PAL.metal, 0.1, yaw);
    for (let i = 0; i < 5; i++) {
      const along = (i / 4 - 0.5) * length;
      for (const side of [-1, 1]) {
        const dx = along * Math.cos(yaw) + side * width * 0.42 * Math.sin(yaw);
        const dz = -along * Math.sin(yaw) + side * width * 0.42 * Math.cos(yaw);
        const rib = this.addBox(x + dx, z + dz, 0.16, width * 0.65, 0.18, PAL.metalLight, 0.25, yaw);
        rib.rotation.x = side * 0.25;
      }
    }
    const shell = new THREE.CylinderGeometry(width * 0.5 * S, width * 0.42 * S, length * 0.72 * S, 8, 1, true, 0, Math.PI * 1.55).rotateZ(Math.PI / 2);
    const hull = this.addShape(shell, PAL.metalLight, x, z, width * 0.4, yaw);
    (hull.material as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
    for (const side of [-1, 1]) {
      this.addBox(x, z + side * width * 0.42, length * 0.68, 0.12, 0.2, PAL.rust.top, width * 0.55, yaw);
    }
    for (let i = -1; i <= 1; i++) {
      this.addBox(x + i * length * 0.2, z, 0.2, 0.22, width * 0.7, PAL.metal, width * 0.88, yaw);
      this.addBox(x + i * length * 0.3, z - width * 0.6, length * 0.12, 0.12, width * 0.3, PAL.metalLight, 0.15, yaw + i * 0.4);
    }
  }
}

function buildOrchard(b: SiteBuilder): void {
  const { orchardRows: rows, orchardSpacing: spacing } = REGION.settlement;
  const half = (rows - 1) / 2;
  const living: { x: number; z: number; yaw: number }[] = [];
  for (let row = 0; row < rows; row++) {
    const x = (row - half) * spacing;
    b.addBox(x - 0.65, 0, 0.18, 0.06, rows * spacing, PAL.wall.dark);
    for (let col = 0; col < rows; col++) {
      const index = row * rows + col;
      const z = (col - half) * spacing;
      if (index % 4 === 0) b.addDeadTree(x, z, index);
      else living.push({ x, z, yaw: hash2(index, 29) * Math.PI * 2 });
    }
  }
  b.addInstances('orchard_tree', living);
  b.addRuin(0, 14, 6, 4);
  for (let i = -6; i <= 6; i++) b.addBox(i * 2, -12, 0.12, 0.65, 0.12, PAL.trunk);
  b.addBox(0, -12, 24, 0.1, 0.12, PAL.trunk, 0.4);
}

function buildSettlement(b: SiteBuilder, site: Site): void {
  const layout = REGION.settlement;
  const limit = site.radius - layout.houseWidth - 0.3;
  let homes = 0;
  for (let x = -limit; x <= limit; x += layout.streetSpacing) {
    for (let z = -limit; z <= limit; z += layout.streetSpacing) {
      if (Math.hypot(x, z) > limit) continue;
      if (site.id === 'bowl' ? Math.hypot(x, z) < 9 : Math.abs(x) < 21 && Math.abs(z) < 9) continue;
      const pos = { x: site.pos.x + x, y: site.pos.y + z };
      if (REGION.roads.some((road) => road.some((point, i) => i > 0 && segmentDist(pos, road[i - 1], point) < REGION.roadWidth / 2 + layout.houseWidth))) continue;
      const h = layout.houseHeights[homes % layout.houseHeights.length];
      const w = layout.houseWidth;
      const d = layout.houseDepth;
      b.addBox(x, z, w, h, d, homes % 3 ? PAL.wall.side : PAL.wall.top);
      b.addBox(x, z, w + 0.3, 0.12, d + 0.3, homes % 4 ? PAL.rust.top : PAL.metal, h);
      b.addBox(x, z + d / 2 + 0.02, 0.3, 0.55, 0.03, PAL.wall.dark);
      for (const dx of [-0.8, 0.8]) {
        b.addBox(x + dx, z + d / 2 + 0.02, 0.3, 0.3, 0.03, PAL.wall.dark, 0.55);
        if (h > 1.5) b.addBox(x + dx, z + d / 2 + 0.02, 0.3, 0.3, 0.03, PAL.wall.dark, 1.25);
      }
      if (homes % 5 === 0) b.addTank(x - 0.6, z - 0.4, 0.3, 0.55, PAL.metalLight, h + 0.12);
      homes++;
    }
  }
  b.root.userData.homes = homes;
  addWall(b, site, townWall());
  // The water tower stands in the open center, clear of the pond, the hull and the roads.
  const tower = site.id === 'bowl' ? { x: -6, z: -6 } : { x: -18, z: 6 };
  b.offRoad(tower.x, tower.z, 1);
  b.addModel('water_tower', tower.x, tower.z);
  if (site.id === 'bowl') {
    b.addTank(0, 0, 6, 0.05, PAL.water);
    for (let row = 0; row < 4; row++) b.addBox(-6 + row * 3, 9, 2, 0.12, 4, PAL.scrub[0]);
  } else {
    b.addHull(-3, -1, 22, 10, 0);
    b.addModel('ship_nose', 12, -1, 0, NOSE_SCALE);
  }
}

type WallStyle = {
  height: number;
  thickness: number;
  segment: number; // tiles per straight section around the curve
  gateWidth: number;
  towerEvery: number | null; // sections between wall towers
  ragged: boolean; // sections vary in height, like scrap and posts
  color: number;
  postColor: number;
  guarded: boolean; // a guard tower on each gate side and a banner pole at each gate
};

function townWall(): WallStyle {
  const s = REGION.settlement;
  return { height: s.wallHeight, thickness: s.wallThickness, segment: s.wallSegment, gateWidth: s.gateWidth, towerEvery: s.wallTowerEvery, ragged: false, color: PAL.wall.side, postColor: PAL.wall.top, guarded: true };
}

function palisade(): WallStyle {
  const s = REGION.settlement;
  return { height: s.palisadeHeight, thickness: s.palisadeThickness, segment: s.palisadeSegment, gateWidth: s.palisadeGateWidth, towerEvery: null, ragged: true, color: PAL.trunk, postColor: PAL.rust.side, guarded: false };
}

// Raider camps hide behind rusted scrap, with a gun tower on each side of every gate.
function campWall(): WallStyle {
  return { ...palisade(), color: PAL.rust.side, postColor: PAL.rust.dark, guarded: true };
}

// A wall on the site's blocked edge, open at each gate. Each section sinks into the ground, so slopes leave
// no gap under it. Box depth runs along the wall, so a yaw of -a turns it onto the tangent at angle a, and
// box width then runs outward.
function addWall(b: SiteBuilder, site: Site, style: WallStyle): void {
  const { height: h, thickness: t, segment } = style;
  const S2 = REGION.settlement;
  const r = site.radius - t / 2;
  const gates = siteGates(site).map((g) => Math.atan2(g.y - site.pos.y, g.x - site.pos.x));
  const count = Math.ceil((2 * Math.PI * r) / segment);
  const step = (2 * Math.PI) / count;
  const gateHalf = style.gateWidth / 2 / r;
  const open = Array.from({ length: count }, (_, i) => gates.some((e) => Math.abs(angleDiff((i + 0.5) * step, e)) < gateHalf + step / 2));
  const length = 2 * r * Math.sin(step / 2) + t;
  const sink = 0.3;
  const at = (a: number, out = 0) => ({ x: Math.cos(a) * (r + out), z: Math.sin(a) * (r + out) });
  let sections = 0;
  for (let i = 0; i < count; i++) {
    if (open[i]) continue;
    const a = (i + 0.5) * step;
    const height = style.ragged ? h * (0.8 + 0.4 * hash2(i, site.pos.x)) : h;
    const p = at(a);
    b.addBox(p.x, p.z, t, height + sink, length, style.color, -sink, -a);
    if (style.towerEvery !== null && i % style.towerEvery === 0 && !open[(i + count - 1) % count]) {
      const q = at(i * step);
      b.addBox(q.x, q.z, t * 2, h * 1.4 + sink, t * 2, style.postColor, -sink, -i * step);
    }
    sections++;
  }
  let gateCount = 0;
  for (let i = 0; i < count; i++) {
    const starts = open[i] && !open[(i + count - 1) % count];
    const ends = open[i] && !open[(i + 1) % count];
    for (const a of [...(starts ? [i * step] : []), ...(ends ? [(i + 1) * step] : [])]) {
      const q = at(a);
      if (!style.guarded) {
        b.addBox(q.x, q.z, t * 1.6, h * 1.4 + sink, t * 1.6, style.postColor, -sink, -a);
        continue;
      }
      const tower = S2.guardTowerHeight;
      b.addBox(q.x, q.z, t * 2.4, tower + sink, t * 2.4, style.postColor, -sink, -a);
      b.addBox(q.x, q.z, t * 3.2, 0.12, t * 3.2, PAL.wall.dark, tower, -a);
      const gun = at(a, t * 1.4);
      b.addBox(gun.x, gun.z, 0.9, 0.12, 0.12, PAL.metal, tower + 0.2, -a);
    }
    if (!starts) continue;
    gateCount++;
    if (!style.guarded) continue;
    // The pole rises from the gate's first tower. Its banner hangs across the tangent, so it faces the road.
    const a = i * step;
    const q = at(a);
    const tower = S2.guardTowerHeight;
    b.addBox(q.x, q.z, 0.12, S2.gatePoleHeight - tower, 0.12, PAL.trunk, tower);
    const flag = { x: q.x - Math.sin(a) * 0.45, z: q.z + Math.cos(a) * 0.45 };
    b.addBox(flag.x, flag.z, 0.05, 1, 0.8, PAL.rust.top, S2.gatePoleHeight - 1.1, -a);
  }
  b.root.userData.wallSections = sections;
  b.root.userData.gates = gateCount;
}

function buildGranary(b: SiteBuilder): void {
  // Silos at the 1.1-tile radius of the old tanks. Their sheds face the loading ruin.
  for (let x = -3; x <= 3; x += 3) b.addModel('silo', x, -1, -Math.PI / 2, (1.1 * S) / 2.5);
  b.addRuin(0, 2.8, 6, 2.2);
  for (let i = 0; i < 8; i++) b.addBox(-2.5 + (i % 4) * 0.65, 2 + Math.floor(i / 4) * 0.65, 0.5, 0.45, 0.5, PAL.crate);
}

function buildPump(b: SiteBuilder): void {
  b.addRuin(-1.7, 0, 3, 3.8);
  b.addModel('pump_station', 2.5, 0);
  b.addBox(-2, 0, 1.2, 0.85, 2, PAL.rust.side);
}

function buildLock(b: SiteBuilder): void {
  for (const x of [-2, 2]) b.addBox(x, 0, 0.6, 1.1, 8, PAL.wall.side);
  b.addBox(0, 0, 3.6, 0.05, 8, PAL.water);
  // The gate wall runs along the model's Y, so a quarter turn sets it across the channel.
  b.addModel('lock_gate', 0, 0, Math.PI / 2);
  b.addRuin(3.7, 0, 1.7, 2);
}

// The deck top follows the sim deck line from sim/terrain.ts, which the physics deck also follows.
function buildBridge(b: SiteBuilder, terrain: Terrain): void {
  const { from, width } = TERRAIN.features.bridge;
  const [h0, h1] = deckEnds(terrain);
  const pitch = Math.atan2((h1 - h0) * S, BRIDGE_LENGTH * S);
  const mid = { x: from.x + (BRIDGE_AXIS.x * BRIDGE_LENGTH) / 2, y: from.y + (BRIDGE_AXIS.y * BRIDGE_LENGTH) / 2 };
  const bridge = b.addModel('bridge', mid.x - b.site.pos.x, mid.y - b.site.pos.y, 0, new THREE.Vector3((BRIDGE_LENGTH * S) / 32, BRIDGE_RISE, (width * S) / 7));
  bridge.position.y = ((h0 + h1) / 2) * S - BRIDGE_DECK_TOP * BRIDGE_RISE;
  // YXZ applies the pitch about the model's own z first, then the yaw.
  bridge.rotation.set(0, -Math.atan2(BRIDGE_AXIS.y, BRIDGE_AXIS.x), pitch, 'YXZ');
  b.addRuin(0, 0, 3, 2);
}

function buildOasis(b: SiteBuilder, well: boolean): void {
  if (well) {
    b.addTank(0, 0, 1.2, 0.8, PAL.wall.side);
    b.addTank(0, 0, 0.9, 0.04, PAL.water, 0.8);
    for (const x of [-1.5, 1.5]) b.addBox(x, 0, 0.18, 2.6, 0.18, PAL.trunk);
    b.addBox(0, 0, 3.3, 0.2, 0.25, PAL.trunk, 2.5);
    b.addRuin(2.7, 2.7, 2.3, 2);
    // The palm model leans, so yaw varies the lean.
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7 + 0.4;
      b.addModel('palm', Math.cos(a) * 4.8, Math.sin(a) * 4.8, a * 2.3);
    }
  } else {
    b.addTank(0, 0, 2.8, 0.04, PAL.waterLight);
    for (let i = 0; i < 9; i++) {
      const a = i * Math.PI * 2 / 9;
      b.addModel('palm', Math.cos(a) * 4, Math.sin(a) * 4, a * 2.3);
    }
  }
}

function buildWrecks(b: SiteBuilder, id: string): void {
  if (id === 'salvage-yard') {
    for (const x of [-3, 0, 3]) {
      b.addBox(x, -2, 2.3, 1.2, 2, PAL.rust.side);
      b.addBox(x, -2, 2.6, 0.12, 2.4, PAL.metalLight, 1.3);
      for (let i = 0; i < 3; i++) b.addBox(x, 1 + i * 0.8, 1.5, 0.5, 0.6, i % 2 ? PAL.metal : PAL.rust.top);
    }
    b.addBox(-3, 1, 0.25, 4, 0.25, PAL.metal);
    b.addBox(-1.5, 1, 3.2, 0.22, 0.22, PAL.metal, 3.8);
    b.addModel('crates', 4.8, 1.8, 0.3);
  } else if (id === 'podfield') {
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4;
      const pod = b.addShape(new THREE.CapsuleGeometry(0.45 * S, 1.1 * S, 2, 6), PAL.metalLight, Math.cos(a) * 3.4, Math.sin(a) * 3.4, 0.65);
      pod.rotation.z = 0.7 + i * 0.3;
    }
    b.addModel('crates', 0, 0, 0.3);
  } else {
    b.addHull(-1, 0, id === 'ridge-wrecks' ? 7 : 4, 2, 0.3);
    b.addHull(2, 3, 3.5, 1.5, -0.6);
    for (let i = 0; i < 5; i++) b.addBox(-3 + i, -3, 0.5, 0.25, 1, PAL.rust.dark, 0, i);
    b.addModel('crates', 3.5, -2.5, 0.3);
  }
}

// Scrap shacks ring a fire pit. Fuel tanks and a stripped hull fill the gaps.
function buildCamp(b: SiteBuilder, id: string): void {
  const turn = id === 'kiln' ? 1.3 : 0;
  for (let i = 0; i < 3; i++) {
    const a = turn + i * 2.1;
    const x = Math.cos(a) * 3.2;
    const z = Math.sin(a) * 3.2;
    b.addBox(x, z, 1.8, 1.1, 1.4, i % 2 ? PAL.rust.side : PAL.metal, 0, -a);
    b.addBox(x, z, 2.1, 0.12, 1.7, PAL.rust.top, 1.1, -a + 0.1);
  }
  b.addTank(0, 0, 0.7, 0.12, PAL.rust.dark);
  for (const a of [turn + 1, turn + 1.3]) b.addTank(Math.cos(a) * 4.3, Math.sin(a) * 4.3, 0.45, 0.9, PAL.rust.top);
  b.addHull(Math.cos(turn + 3.1) * 3.6, Math.sin(turn + 3.1) * 3.6, 3, 1.4, turn + 1.6);
  b.addModel('crates', Math.cos(turn + 5.2) * 3.5, Math.sin(turn + 5.2) * 3.5, turn);
}

function buildSite(t: Terrain, site: Site): THREE.Group {
  const b = new SiteBuilder(t, site);
  switch (site.id) {
    case 'orchard': buildOrchard(b); break;
    case 'granary': buildGranary(b); break;
    case 'pump-station': buildPump(b); break;
    case 'south-lock': buildLock(b); break;
    case 'canyon-bridge': buildBridge(b, t); break;
    case 'dustwell': buildOasis(b, true); break;
    case 'green-pit': buildOasis(b, false); break;
    case 'fallen-sun':
      b.addModel('ship_hull', 0, 0, -0.2, HULL_SCALE);
      b.addBox(-10, 16, 25, 0.3, 15, PAL.metalLight, 0.6, 0.3);
      for (const z of [-8, 8]) b.addTank(-33, z, 3, 5, PAL.rust.dark);
      break;
    case 'glass-flats': b.addModel('glass_flats', 0, 0); break;
    case 'nose': case 'bowl': buildSettlement(b, site); break;
    case 'burnt-convoy': case 'podfield': case 'ridge-wrecks': case 'salvage-yard': buildWrecks(b, site.id); break;
    case 'scrapjaw': case 'kiln': buildCamp(b, site.id); break;
    default: throw new Error(`Missing landmark model for ${site.id}`);
  }
  if ('kind' in site && site.walled) addWall(b, site, site.kind === 'camp' ? campWall() : palisade());
  // Site models never move after they are built.
  b.root.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
  return b.root;
}

const UP = new THREE.Vector3(0, 1, 0);

// Every site model under one group, for inspection.
export function buildSites(t: Terrain): THREE.Group {
  const group = new THREE.Group();
  for (const site of [...REGION.towns, ...REGION.locations]) group.add(buildSite(t, site));
  return group;
}

// Registers every site model with the scope at its site.
export function addSites(t: Terrain, scope: RenderScope): void {
  for (const site of [...REGION.towns, ...REGION.locations]) scope.add(buildSite(t, site), site.pos, site.radius);
}
