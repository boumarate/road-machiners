// Nose's interior (C5): the Fallen Sun's nose and broken hull lying across the back of the site, half-buried in rock
// heaps around its torn rear, with a radar dish turning on the nose. In front of the hull stand clusters of small scrap
// shelters with lit doorways, timber platforms with stairs against the hull flank, a red awning, a water tower, a jib
// crane, crate stacks and a parked van.
//
// Offsets are site tiles: x is map x, z is map y. The layout is authored in the ship's frame: u runs along the ship
// toward the nose tip (southwest, screen left from the default camera at +x +y) and v runs back, away from the
// camera (northwest). The ship's axis lies SHIP.offset tiles back, square to the camera's view, as C5 shows it.

import * as THREE from 'three';
import { PHYSICS } from '../../../data/physics';
import { PAL } from '../../../render/palette';
import { hash2 } from '../../../render/noise';
import { fortressGates } from '../../../sim/fortress';
import type { Site } from '../../../sim/sites';
import { model, socket, type ModelName } from '../models';
import { spin } from '../site-motion';
import { fitsCurtain, type SiteBuilder } from '../sites';

const S = PHYSICS.metersPerTile;
const AXIS = { x: -Math.SQRT1_2, z: Math.SQRT1_2 }; // u
const BACK = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 }; // v
const FRONT_YAW = -Math.PI / 4; // turns a model's +X toward the camera (-v)

// The nose joint's place, u tiles along and offset tiles back. The ship runs from its tip 11 tiles further along to its
// torn stern 31.5 tiles back, so it is centered on the site's middle along u. yaw turns the models' +X along u.
const SHIP = { joint: 10.25, offset: 14, yaw: (-3 * Math.PI) / 4 };
// Each section's origin along the ship, in meters from the nose joint toward the tip. ship_nose and the hull rings
// and ribs have their origin at their rear joint; the stern has its origin at its front joint and runs back.
const SECTIONS: readonly { name: ModelName; at: number }[] = [
  { name: 'ship_nose', at: 0 },
  { name: 'ship_hull_ring', at: -32 },
  { name: 'ship_hull_ring', at: -64 },
  { name: 'ship_hull_ribs', at: -96 },
  { name: 'ship_hull_stern', at: -96 },
];
const SHIP_ENDS = { tip: 44, stern: -126 }; // meters from the nose joint
const DISH_TURN = 8; // seconds per turn of the radar dish

// Rock heaps as boxes in (u, v), with how many rocks to try and their scale range. The rock model is 1 m in radius
// and 1.1 m tall at scale 1. Each sinks a quarter of its height.
const HEAPS = [
  { u: [-31, -13], v: [-2, 28], count: 80, scale: [10, 22] }, // banked over the torn stern, C5's slope
  { u: [-13, 23], v: [18.5, 28], count: 40, scale: [6, 12] }, // behind the hull, up to the curtain
  { u: [8, 22], v: [8.5, 13], count: 16, scale: [2.5, 6] }, // the bed under the nose
  { u: [-14, 9], v: [8.6, 10.6], count: 18, scale: [1.5, 3.5] }, // rubble along the flank
] as const;
const ROCK_SINK = 0.25 * 1.1;
const ROCK_REACH = 29.3; // tiles from the center a rock may reach, clear of the tower footprints

// Shelter clusters in (u, v): denser along the hull flank, sparser toward the gate, as in C5.
const CLUSTERS = [
  { u: -16, v: 5.5, count: 4 },
  { u: -5, v: 5.5, count: 4 },
  { u: 5, v: 6, count: 4 },
  { u: 14, v: 5, count: 3 },
  { u: -12, v: -2, count: 4 },
  { u: 1, v: -1, count: 4 },
  { u: 12, v: -4, count: 3 },
  { u: -18, v: -5, count: 3 },
  { u: -6, v: -8, count: 4 },
  { u: 7, v: -9, count: 3 },
  { u: -13, v: -12, count: 3 },
  { u: 17, v: -6, count: 2 },
] as const;
// A shelter's 8 m by 6 m footprint turned any way fits in SPAN tiles. Neighbours keep GAP tiles apart, within SPREAD
// tiles of their cluster's center, and no shelter stands nearer the ship axis than HULL_CLEAR tiles back.
const SHELTER = { span: 2.6, gap: 0.4, spread: 3.6, tries: 10 };
const HULL_CLEAR = 8.7;

// Platforms against the hull flank, their back against the plates at 4 m above the ground. Neighbours 3 tiles
// apart join into one long two-level platform, as in C5.
const SCAFFOLDS = [-16, -13, -10, -2, 1].map((u) => ({ u, v: SHIP.offset - 3.97 - 0.05 - 2.5 / S }));
const AWNING = { u: -1, v: 3.6, w: 2.6, d: 2, lift: 0.95, post: 0.08 };
const WATER_TOWER = { u: 10, v: 0.5 };
const JIB_CRANE = { u: 17, v: 1 };
const CRATES = [
  { u: 15.5, v: -1.5 },
  { u: -8, v: 1.6 },
  { u: 3, v: -6 },
  { u: -18, v: 2.5 },
];
const VAN = { u: 10, v: -13, yaw: 0.4 };
const GATE_CLEAR = 1.5; // tiles kept open inside each gate past half its width
const UP = new THREE.Vector3(0, 1, 0);

type Disc = { x: number; z: number; r: number };
type Spot = { x: number; z: number; yaw: number };

// The site offset of a point u tiles along the ship and v tiles back.
function at(u: number, v: number): { x: number; z: number } {
  return { x: u * AXIS.x + v * BACK.x, z: u * AXIS.z + v * BACK.z };
}

export function buildNose(b: SiteBuilder, site: Site): void {
  addShip(b);
  const taken = gateDiscs(site);
  addYard(b, taken);
  b.root.userData.homes = addShelters(b, site, taken);
  addRocks(b, site, gateDiscs(site));
}

// The ship's sections in one group on the ground at the nose joint. The sections rest on the lowest ground under the
// ship's axis, so on uneven ground none floats and the joints still meet.
function addShip(b: SiteBuilder): void {
  const anchor = at(SHIP.joint, SHIP.offset);
  const ship = new THREE.Group();
  ship.name = 'nose-ship';
  const ground = b.groundAt(anchor.x, anchor.z);
  ship.position.set((b.site.pos.x + anchor.x) * S, ground * S, (b.site.pos.y + anchor.z) * S);
  ship.rotation.y = SHIP.yaw;
  b.root.add(ship);
  const rest = (lowestUnderShip(b) - ground) * S;
  const sections = SECTIONS.map(({ name, at: along }) => {
    const section = model(name);
    section.name = 'nose-ship-section';
    section.position.set(along, rest, 0);
    ship.add(section);
    return section;
  });
  const dish = model('radar_dish');
  dish.name = 'nose-radar-dish';
  dish.position.copy(socket('ship_nose', 'dish'));
  sections[0].add(dish);
  b.addMover(dish, spin(UP, DISH_TURN));
}

function lowestUnderShip(b: SiteBuilder): number {
  let lowest = Infinity;
  for (let m = SHIP_ENDS.stern; m <= SHIP_ENDS.tip; m += S) {
    const p = at(SHIP.joint + m / S, SHIP.offset);
    lowest = Math.min(lowest, b.groundAt(p.x, p.z));
  }
  return lowest;
}

// The open ground inside each gate.
function gateDiscs(site: Site): Disc[] {
  return fortressGates(site).map((g) => ({ x: g.face.x - site.pos.x, z: g.face.y - site.pos.y, r: g.width / 2 + GATE_CLEAR }));
}

// The platforms, the awning, the water tower, the jib crane, crates and the van. Each claims its ground.
function addYard(b: SiteBuilder, taken: Disc[]): void {
  for (const s of SCAFFOLDS) {
    const p = at(s.u, s.v);
    b.addModel('hull_scaffold', p.x, p.z, FRONT_YAW).name = 'nose-scaffold';
    taken.push({ ...p, r: 2.2 });
  }
  addAwning(b, taken);
  const tower = at(WATER_TOWER.u, WATER_TOWER.v);
  b.addModel('water_tower', tower.x, tower.z, FRONT_YAW).name = 'nose-water-tower';
  taken.push({ ...tower, r: 1.4 });
  const crane = at(JIB_CRANE.u, JIB_CRANE.v);
  b.addModel('jib_crane', crane.x, crane.z, FRONT_YAW + Math.PI / 2).name = 'nose-jib-crane';
  taken.push({ ...crane, r: 2.2 });
  for (const [i, c] of CRATES.entries()) {
    const p = at(c.u, c.v);
    b.addModel('crates', p.x, p.z, i * 1.3);
    taken.push({ ...p, r: 0.8 });
  }
  addVan(b, taken);
}

// C5's red open awning: a roof on four posts.
function addAwning(b: SiteBuilder, taken: Disc[]): void {
  const { w, d, lift, post } = AWNING;
  const p = at(AWNING.u, AWNING.v);
  b.addBox(p.x, p.z, w, 0.06, d, PAL.roof[2], lift, FRONT_YAW).name = 'nose-awning';
  for (const [i, j] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const q = { x: p.x + (AXIS.x * i * (w / 2 - post) + BACK.x * j * (d / 2 - post)), z: p.z + (AXIS.z * i * (w / 2 - post) + BACK.z * j * (d / 2 - post)) };
    b.addBox(q.x, q.z, post, lift, post, PAL.trunk, 0, FRONT_YAW);
  }
  taken.push({ ...p, r: 1.8 });
}

// The van chassis model, its wheels set on the ground (its origin is its collider's center).
function addVan(b: SiteBuilder, taken: Disc[]): void {
  const p = at(VAN.u, VAN.v);
  const van = b.addModel('base_van', p.x, p.z, FRONT_YAW + VAN.yaw);
  van.name = 'nose-van';
  van.updateMatrixWorld(true);
  van.position.y -= new THREE.Box3().setFromObject(van).min.y - van.position.y;
  taken.push({ ...p, r: 1.2 });
}

// Shelters in their clusters, each clear of the curtain, the hull, the gates and every other shelter. Returns how many
// stand.
function addShelters(b: SiteBuilder, site: Site, taken: Disc[]): number {
  const spots: { flat: Spot[]; lean: Spot[] } = { flat: [], lean: [] };
  let homes = 0;
  CLUSTERS.forEach((cluster, c) => {
    let placed = 0;
    for (let k = 0; k < cluster.count * SHELTER.tries && placed < cluster.count; k++) {
      const spot = shelterSpot(cluster, c, k);
      if (!shelterFits(site, spot, taken)) continue;
      taken.push({ x: spot.x, z: spot.z, r: SHELTER.span / 2 + SHELTER.gap / 2 });
      (hash2(c, k + 50) < 0.5 ? spots.flat : spots.lean).push(spot);
      placed++;
    }
    homes += placed;
  });
  b.addInstances('scrap_shelter_flat', spots.flat).name = 'nose-shelters';
  b.addInstances('scrap_shelter_lean', spots.lean).name = 'nose-shelters';
  return homes;
}

// A candidate around a cluster's center. Most doors face the camera, the rest along the ship either way.
function shelterSpot(cluster: { u: number; v: number }, c: number, k: number): Spot & { v: number } {
  const angle = hash2(c * 13 + k, 7) * 2 * Math.PI;
  const reach = Math.sqrt(hash2(k, c * 13 + 3)) * SHELTER.spread;
  const u = cluster.u + Math.cos(angle) * reach;
  const v = cluster.v + Math.sin(angle) * reach;
  const facing = hash2(c + 100, k);
  const turn = facing < 0.6 ? 0 : facing < 0.8 ? Math.PI / 2 : -Math.PI / 2;
  return { ...at(u, v), yaw: FRONT_YAW + turn, v };
}

function shelterFits(site: Site, spot: Spot & { v: number }, taken: Disc[]): boolean {
  if (spot.v + SHELTER.span / 2 > HULL_CLEAR) return false;
  if (!fitsCurtain(site, spot.x, spot.z, SHELTER.span, SHELTER.span)) return false;
  return !taken.some((d) => Math.hypot(d.x - spot.x, d.z - spot.z) < d.r + SHELTER.span / 2 + SHELTER.gap / 2);
}

// The rock heaps, as one instanced rock model, each rock inside the curtain and clear of the gates.
function addRocks(b: SiteBuilder, site: Site, gates: Disc[]): void {
  const rocks: (Spot & { scale: number; lift: number })[] = [];
  HEAPS.forEach((heap, h) => {
    for (let i = 0; i < heap.count; i++) {
      const pick = (salt: number, [lo, hi]: readonly [number, number]) => lo + (hi - lo) * hash2(i * 7 + salt, h * 31 + salt);
      const p = at(pick(1, heap.u), pick(2, heap.v));
      const scale = pick(3, heap.scale);
      const r = scale / S;
      if (Math.hypot(p.x, p.z) + r > ROCK_REACH || gates.some((g) => Math.hypot(g.x - p.x, g.z - p.z) < g.r + r)) continue;
      if (!fitsCurtain(site, p.x, p.z, r, r)) continue;
      rocks.push({ ...p, yaw: pick(4, [0, 2 * Math.PI]), scale, lift: (-ROCK_SINK * scale) / S });
    }
  });
  b.addInstances('rock', rocks).name = 'nose-rocks';
}
