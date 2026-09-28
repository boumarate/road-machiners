// Static map obstacles: rocks, wrecks, buildings, water and baked landmarks. Map rocks are drawn once
// as an instanced model per terrain chunk. Other obstacles are synced by id, so wrecks that appear mid-game (a vehicle dying)
// get added without touching the rest. Loose loot piles and the debris of broken props are synced the same way.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hashStr } from '../../render/noise';
import { PAL } from '../../render/palette';
import { PHYSICS } from '../../data/physics';
import { propPose, propReach, type PropPose } from '../../sim/mapgen';
import { heightAt, type Terrain } from '../../sim/terrain';
import { hasSalvage, salvageUnits } from '../../sim/salvage';
import type { BrokenProp, Obstacle, SalvageStock } from '../../sim/types';
import { dist } from '../../sim/vec';
import { instancedModel, model, socket } from './models';
import type { RenderScope } from './scope';
import { TERRAIN_CHUNK } from './terrain';

const S = PHYSICS.metersPerTile;
const CRATES_RADIUS = 1.5; // meters, the reference radius of tools/blender/crates.py
const PILE_FULL_UNITS = 20; // loot units at which a pile reaches the crates model's full size, about a full pickup bed
const PILE_MIN_SIZE = 0.5; // share of full size for a small pile, so it still reads at the default zoom
const DEBRIS_SCATTER = 0.3; // meters a debris piece lies at most from where it stood, so the pieces read as one wreckage
const DEBRIS_TURN = 0.4; // radians a debris piece turns at most, so the pieces do not line up like the standing prop

export class ObstacleViews {
  private readonly byId = new Map<string, THREE.Object3D>();
  private rockIds: Set<string> | null = null; // map rocks, fixed at the first sync with the power lines
  private readonly piles = new Map<string, { obj: THREE.Object3D; units: number }>();
  private readonly debris = new Map<string, THREE.Object3D>();

  constructor(private readonly scope: RenderScope, private readonly terrain: Terrain) {}

  sync(obstacles: Obstacle[], salvage: SalvageStock[], broken: readonly BrokenProp[]): void {
    this.syncDebris(broken);
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
        this.scope.add(obj, o.pos, viewReach(o));
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

  // Each broken prop lies as debris where it stood until it grows back. Debris blocks nothing.
  private syncDebris(broken: readonly BrokenProp[]): void {
    const ids = new Set(broken.map((b) => b.obstacle.id));
    for (const [id, obj] of this.debris) {
      if (ids.has(id)) continue;
      this.scope.remove(obj);
      disposeTree(obj);
      this.debris.delete(id);
    }
    for (const { obstacle } of broken) {
      if (this.debris.has(obstacle.id)) continue;
      const obj = buildDebris(this.terrain, obstacle);
      obj.traverse((m) => {
        m.updateMatrix();
        m.matrixAutoUpdate = false;
      });
      this.scope.add(obj, obstacle.pos, propReach(obstacle) + DEBRIS_SCATTER / S);
      this.debris.set(obstacle.id, obj);
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
      const reach = Math.max(...list.map((o) => dist(center, o.pos) + propReach(o)));
      this.scope.add(group, center, reach);
    }
    return new Set(rocks.map((o) => o.id));
  }
}

// Tiles from an obstacle's position that its view can cover. A prop's boxes may reach past its radius.
function viewReach(o: Obstacle): number {
  return o.kind === 'water' || o.kind === 'site' ? o.r : propReach(o);
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
  if (o.kind === 'water') return buildWater(t, o);
  // A site's boundary blocks traffic but has no model of its own; buildSites draws the site.
  if (o.kind === 'site') return new THREE.Group();
  return buildProp(t, o);
}

function seat(t: Terrain, o: Obstacle): THREE.Group {
  const g = new THREE.Group();
  g.position.set(o.pos.x * S, heightAt(t, o.pos.x, o.pos.y) * S, o.pos.y * S);
  return g;
}

// A boulder from tools/blender/rock.py, modeled at a 1 m radius. Each rock gets its own tint.
function rockPlacement(t: Terrain, o: Obstacle): { matrix: THREE.Matrix4; tint: number } {
  const g = posed(t, propPose(o));
  g.updateMatrix();
  return { matrix: g.matrix, tint: 0.9 + hashStr(o.id) * 0.2 };
}

// A group at the prop's pose. A three.js turn by -yaw points the model's +X at map direction yaw. Model
// sideways is three.js z and model up is three.js y.
function posed(t: Terrain, pose: PropPose): THREE.Group {
  const g = new THREE.Group();
  g.position.set(pose.pos.x * S, heightAt(t, pose.pos.x, pose.pos.y) * S, pose.pos.y * S);
  g.rotation.y = -pose.yaw;
  g.scale.set(pose.scale.x, pose.scale.z, pose.scale.y);
  return g;
}

// Wrecks, settlement buildings and baked landmarks. A building gets a roof color from its id.
function buildProp(t: Terrain, o: Obstacle): THREE.Object3D {
  const pose = propPose(o);
  const g = posed(t, pose);
  const obj = model(pose.model);
  if (pose.model === 'building') paintRoof(obj, o.id);
  g.add(obj);
  return g;
}

// A broken prop's model at its pose, each piece tipped over flat onto the ground, pushed and turned a little.
function buildDebris(t: Terrain, o: Obstacle): THREE.Object3D {
  const pose = propPose(o);
  const g = posed(t, pose);
  const obj = model(pose.model);
  obj.updateMatrixWorld(true);
  const pieces: THREE.Mesh[] = [];
  obj.traverse((m) => {
    if (m instanceof THREE.Mesh) pieces.push(m);
  });
  pieces.forEach((mesh, i) => g.add(tipPiece(mesh, `${o.id}:${i}`)));
  return g;
}

// A copy of one model piece in a pivot at its ground point below its center. The pivot turns a quarter about the
// model's forward axis, so the piece lies on its side, and rises until the piece's lowest point rests on the ground.
// The key seeds its side, push and turn.
function tipPiece(mesh: THREE.Mesh, key: string): THREE.Object3D {
  const piece = new THREE.Mesh(mesh.geometry, mesh.material);
  piece.castShadow = mesh.castShadow;
  piece.receiveShadow = mesh.receiveShadow;
  mesh.matrixWorld.decompose(piece.position, piece.quaternion, piece.scale);
  const center = new THREE.Box3().setFromObject(piece).getCenter(new THREE.Vector3());
  piece.position.x -= center.x;
  piece.position.z -= center.z;
  const pivot = new THREE.Group();
  pivot.add(piece);
  const side = hashStr(`${key}:side`) < 0.5 ? 1 : -1;
  pivot.rotation.set((side * Math.PI) / 2, (hashStr(`${key}:turn`) * 2 - 1) * DEBRIS_TURN, 0, 'YXZ');
  pivot.position.set(center.x + jitter(`${key}:x`), 0, center.z + jitter(`${key}:z`));
  pivot.updateMatrixWorld(true);
  pivot.position.y = -new THREE.Box3().setFromObject(pivot).min.y;
  return pivot;
}

function jitter(key: string): number {
  return (hashStr(key) * 2 - 1) * DEBRIS_SCATTER;
}

function paintRoof(house: THREE.Object3D, id: string): void {
  const roof = PAL.roof[Math.floor(hashStr(id) * 97) % PAL.roof.length];
  eachMaterial(house, (m) => {
    if (m.name === 'roof') m.color.setHex(roof);
  });
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

type Landmark = Extract<Obstacle, { kind: 'landmark' }>;

const WIRES = ['wire0', 'wire1', 'wire2'];
const SAG = 0.7; // meters a wire hangs below its ends at mid-span
const WIRE_POINTS = 8;

// Wires between neighboring poles of one line: poles whose ids name the same line and following steps.
export function addPowerLines(t: Terrain, obstacles: Obstacle[], scope: RenderScope): void {
  const poles = new Map(obstacles.filter((o): o is Landmark => o.kind === 'landmark' && o.look === 'pole').map((o) => [o.id, o]));
  const material = new THREE.MeshLambertMaterial({ color: PAL.wheel });
  for (const a of poles.values()) {
    const b = poles.get(nextId(a.id));
    if (!b) continue;
    const ends = [a, b].map((p) => buildProp(t, p));
    for (const e of ends) e.updateMatrixWorld(true);
    const spans = WIRES.map((w) => span(socket('power_pole', w).applyMatrix4(ends[0].matrixWorld), socket('power_pole', w).applyMatrix4(ends[1].matrixWorld)));
    const mesh = new THREE.Mesh(mergeGeometries(spans), material);
    scope.add(mesh, { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 }, dist(a.pos, b.pos) / 2 + 1);
  }
}

// Pole ids end in their step along the line.
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
