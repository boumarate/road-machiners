// Static map obstacles: rocks, wrecks, buildings, water and roadside landmarks. Map rocks are drawn once
// as an instanced model per terrain chunk. Other obstacles are synced by id, so wrecks that appear mid-game (a vehicle dying)
// get added without touching the rest. Loose loot piles are synced the same way.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hashStr } from '../../render/noise';
import { PAL } from '../../render/palette';
import { PHYSICS } from '../../data/physics';
import { REGION } from '../../data/region';
import { heightAt, type Terrain } from '../../sim/terrain';
import { hasSalvage, salvageUnits } from '../../sim/salvage';
import type { Obstacle, SalvageStock } from '../../sim/types';
import { dist } from '../../sim/vec';
import { instancedModel, model, socket, type ModelName } from './models';
import type { RenderScope } from './scope';
import { TERRAIN_CHUNK } from './terrain';

const S = PHYSICS.metersPerTile;
const CRATES_RADIUS = 1.5; // meters, the reference radius of tools/blender/crates.py
const PILE_FULL_UNITS = 20; // loot units at which a pile reaches the crates model's full size, about a full pickup bed
const PILE_MIN_SIZE = 0.5; // share of full size for a small pile, so it still reads at the default zoom

export class ObstacleViews {
  private readonly byId = new Map<string, THREE.Object3D>();
  private rockIds: Set<string> | null = null; // map rocks, fixed at the first sync with the power lines
  private readonly piles = new Map<string, { obj: THREE.Object3D; units: number }>();

  constructor(private readonly scope: RenderScope, private readonly terrain: Terrain) {}

  sync(obstacles: Obstacle[], salvage: SalvageStock[]): void {
    this.syncPiles(salvage);
    if (!this.rockIds) {
      this.rockIds = this.addRocks(obstacles.filter((o) => o.kind === 'rock'));
      addPowerLines(this.terrain, obstacles, this.scope);
    }
    const seen = new Set<string>();
    let rocks = 0;
    for (const o of obstacles) {
      if (o.kind === 'rock') {
        if (!this.rockIds.has(o.id)) throw new Error(`Rock ${o.id} appeared after map generation; rocks are drawn as fixed instances`);
        rocks++;
        continue;
      }
      seen.add(o.id);
      if (!this.byId.has(o.id)) {
        const obj = buildObstacle(this.terrain, o);
        obj.traverse((m) => {
          m.updateMatrix();
          m.matrixAutoUpdate = false;
        });
        this.scope.add(obj, o.pos, o.r);
        this.byId.set(o.id, obj);
      }
    }
    if (rocks !== this.rockIds.size) throw new Error('A map rock was removed; rocks are drawn as fixed instances');
    for (const [id, obj] of this.byId) {
      if (seen.has(id)) continue;
      this.scope.remove(obj);
      disposeTree(obj);
      this.byId.delete(id);
    }
  }

  // A pile is drawn while it holds loot. Its footprint grows with its loot, so its size follows the square root of the units.
  private syncPiles(salvage: SalvageStock[]): void {
    const shown = salvage.filter((stock) => stock.pile && hasSalvage(stock));
    const ids = new Set(shown.map((stock) => stock.id));
    for (const [id, pile] of this.piles) {
      if (ids.has(id)) continue;
      this.scope.remove(pile.obj);
      disposeTree(pile.obj);
      this.piles.delete(id);
    }
    for (const stock of shown) {
      const pile = this.piles.get(stock.id) ?? this.addPile(stock);
      const units = salvageUnits(stock);
      if (pile.units === units) continue;
      pile.units = units;
      pile.obj.scale.setScalar(Math.max(PILE_MIN_SIZE, Math.min(1, Math.sqrt(units / PILE_FULL_UNITS))));
      pile.obj.traverse((o) => o.updateMatrix());
    }
  }

  private addPile(stock: SalvageStock): { obj: THREE.Object3D; units: number } {
    const obj = model('crates');
    obj.position.set(stock.pos.x * S, heightAt(this.terrain, stock.pos.x, stock.pos.y) * S, stock.pos.y * S);
    obj.rotation.y = hashStr(stock.id) * Math.PI * 2;
    obj.traverse((o) => (o.matrixAutoUpdate = false));
    const pile = { obj, units: 0 };
    this.scope.add(obj, stock.pos, CRATES_RADIUS / S);
    this.piles.set(stock.id, pile);
    return pile;
  }

  // One instanced rock model per chunk, with the placement and tint of rockPlacement.
  private addRocks(rocks: Obstacle[]): Set<string> {
    const byChunk = new Map<string, Obstacle[]>();
    for (const o of rocks) {
      const key = `${Math.floor(o.pos.x / TERRAIN_CHUNK)},${Math.floor(o.pos.y / TERRAIN_CHUNK)}`;
      const list = byChunk.get(key);
      if (list) list.push(o);
      else byChunk.set(key, [o]);
    }
    for (const list of byChunk.values()) {
      const placed = list.map((o) => rockPlacement(this.terrain, o));
      const group = instancedModel('rock', placed.map((p) => p.matrix), placed.map((p) => p.tint));
      const center = list.reduce((c, o) => ({ x: c.x + o.pos.x / list.length, y: c.y + o.pos.y / list.length }), { x: 0, y: 0 });
      const reach = Math.max(...list.map((o) => dist(center, o.pos) + o.r));
      this.scope.add(group, center, reach);
    }
    return new Set(rocks.map((o) => o.id));
  }
}

function disposeTree(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m.dispose();
    }
  });
}

function buildObstacle(t: Terrain, o: Obstacle): THREE.Object3D {
  if (o.kind === 'wreck') return buildWreck(t, o);
  if (o.kind === 'building') return buildBuilding(t, o);
  if (o.kind === 'water') return buildWater(t, o);
  if (o.kind === 'landmark') return buildLandmark(t, o);
  // A site's boundary blocks traffic but has no model of its own; buildSites draws the site.
  if (o.kind === 'site') return new THREE.Group();
  throw new Error(`No model for obstacle kind ${(o as Obstacle).kind}`);
}

function seat(t: Terrain, o: Obstacle): THREE.Group {
  const g = new THREE.Group();
  g.position.set(o.pos.x * S, heightAt(t, o.pos.x, o.pos.y) * S, o.pos.y * S);
  return g;
}

// A boulder from tools/blender/rock.py, modeled at a 1 m radius. Each rock gets its own yaw and tint.
function rockPlacement(t: Terrain, o: Obstacle): { matrix: THREE.Matrix4; tint: number } {
  const seed = hashStr(o.id);
  const g = seat(t, o);
  g.rotation.y = seed * Math.PI * 2;
  g.scale.setScalar(o.r * S);
  g.updateMatrix();
  return { matrix: g.matrix, tint: 0.9 + seed * 0.2 };
}

// A burnt pickup from tools/blender/wreck.py, modeled at the 0.7-tile reference size.
function buildWreck(t: Terrain, o: Obstacle): THREE.Object3D {
  const seed = hashStr(o.id);
  const g = seat(t, o);
  g.rotation.y = -seed * Math.PI * 2;
  g.scale.setScalar(o.r / 0.7);
  g.add(model('wreck'));
  return g;
}

// A building from tools/blender/building.py, modeled with a 1 by 0.85 m footprint and 1 m walls, stretched to
// each footprint and height. Random roof color per id.
function buildBuilding(t: Terrain, o: Obstacle): THREE.Object3D {
  const seed = hashStr(o.id);
  const size = o.r * 0.78 * 2 * S; // full footprint, in meters
  const height = (16 + seed * 20) * (S / 45); // 45px per height unit in the 2D relief scale
  const roof = PAL.roof[Math.floor(seed * 97) % PAL.roof.length];
  const g = seat(t, o);
  g.rotation.y = -seed * Math.PI;
  g.scale.set(size, height, size);
  const house = model('building');
  eachMaterial(house, (m) => {
    if (m.name === 'roof') m.color.setHex(roof);
  });
  g.add(house);
  return g;
}

function eachMaterial(obj: THREE.Object3D, fn: (m: THREE.MeshLambertMaterial) => void): void {
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) fn(m as THREE.MeshLambertMaterial);
  });
}

function buildWater(t: Terrain, o: Obstacle): THREE.Object3D {
  const r = o.r * S;
  const g = seat(t, o);
  const pond = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.3, 24), new THREE.MeshLambertMaterial({ color: PAL.water }));
  pond.position.y = 0.1;
  pond.receiveShadow = true;
  g.add(pond);
  return g;
}

// Roadside landmarks from src/sim/mapgen.ts: power poles with sagging wires between them, billboards,
// rock spires and dead tanks. Billboards face their road. A pole's crossbar lies across its road, so the
// wires run along it. Spires and tanks take a yaw from their id.

type Landmark = Extract<Obstacle, { kind: 'landmark' }>;

const MODELS: Record<Landmark['look'], ModelName> = { pole: 'power_pole', billboard: 'billboard', crag: 'crag', tank: 'tank_hulk' };
// Reference footprint radius in tiles of the models that scale with their obstacle. The others are built
// at their real size for their fixed radius.
const CRAG_RADIUS = 1 / S;
const WIRES = ['wire0', 'wire1', 'wire2'];
const SAG = 0.7; // meters a wire hangs below its ends at mid-span
const WIRE_POINTS = 8;

function buildLandmark(t: Terrain, o: Landmark): THREE.Object3D {
  const g = new THREE.Group();
  g.position.set(o.pos.x * S, heightAt(t, o.pos.x, o.pos.y) * S, o.pos.y * S);
  g.rotation.y = -yawOf(o);
  if (o.look === 'crag') g.scale.setScalar(o.r / CRAG_RADIUS);
  g.add(model(MODELS[o.look]));
  return g;
}

// Map yaw of the model's +X. A three.js turn by -yaw about y points +X at map direction yaw.
function yawOf(o: Landmark): number {
  if (o.look === 'pole') return o.yaw + Math.PI / 2;
  if (o.look === 'billboard') return o.yaw;
  return hashStr(o.id) * Math.PI * 2;
}

// Wires between neighboring poles of one line: poles of the same road whose steps follow each other.
export function addPowerLines(t: Terrain, obstacles: Obstacle[], scope: RenderScope): void {
  const poles = obstacles.filter((o): o is Landmark => o.kind === 'landmark' && o.look === 'pole');
  const material = new THREE.MeshLambertMaterial({ color: PAL.wheel });
  const spacing = REGION.landmarks.find((d) => d.look === 'pole')!.spacing;
  for (const a of poles) {
    const b = poles.find((p) => p.id === nextId(a.id));
    if (!b || dist(a.pos, b.pos) > spacing * 1.5) continue;
    const ends = [a, b].map((p) => buildLandmark(t, p));
    for (const e of ends) e.updateMatrixWorld(true);
    const spans = WIRES.map((w) => span(socket('power_pole', w).applyMatrix4(ends[0].matrixWorld), socket('power_pole', w).applyMatrix4(ends[1].matrixWorld)));
    const mesh = new THREE.Mesh(mergeGeometries(spans), material);
    scope.add(mesh, { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 }, dist(a.pos, b.pos) / 2 + 1);
  }
}

// Pole ids end in their step along the road.
function nextId(id: string): string {
  const cut = id.lastIndexOf('-');
  return `${id.slice(0, cut)}-${Number(id.slice(cut + 1)) + 1}`;
}

function span(from: THREE.Vector3, to: THREE.Vector3): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= WIRE_POINTS; i++) {
    const k = i / WIRE_POINTS;
    points.push(from.clone().lerp(to, k).add(new THREE.Vector3(0, -SAG * 4 * k * (1 - k), 0)));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), WIRE_POINTS, 0.05, 3, false);
}
