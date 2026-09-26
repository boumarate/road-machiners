// Static map obstacles: rocks, wrecks, buildings, water. Synced by id, so wrecks that appear
// mid-game (a vehicle dying) get added without touching the rest.

import * as THREE from 'three';
import { hashStr } from '../../render/noise';
import { PAL } from '../../render/palette';
import { PHYSICS } from '../../data/physics';
import { heightAt, type Terrain } from '../../sim/terrain';
import type { Obstacle } from '../../sim/types';
import { model } from './models';

const S = PHYSICS.metersPerTile;

export class ObstacleViews {
  private readonly byId = new Map<string, THREE.Object3D>();

  constructor(private readonly parent: THREE.Object3D, private readonly terrain: Terrain) {}

  sync(obstacles: Obstacle[]): void {
    const seen = new Set<string>();
    for (const o of obstacles) {
      seen.add(o.id);
      if (!this.byId.has(o.id)) {
        const mesh = buildObstacle(this.terrain, o);
        this.parent.add(mesh);
        this.byId.set(o.id, mesh);
      }
    }
    for (const [id, obj] of this.byId) {
      if (seen.has(id)) continue;
      this.parent.remove(obj);
      disposeTree(obj);
      this.byId.delete(id);
    }
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
  if (o.kind === 'rock') return buildRock(t, o);
  if (o.kind === 'wreck') return buildWreck(t, o);
  if (o.kind === 'building') return buildBuilding(t, o);
  if (o.kind === 'water') return buildWater(t, o);
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
function buildRock(t: Terrain, o: Obstacle): THREE.Object3D {
  const seed = hashStr(o.id);
  const g = seat(t, o);
  g.rotation.y = seed * Math.PI * 2;
  g.scale.setScalar(o.r * S);
  const rock = model('rock');
  const tint = 0.9 + seed * 0.2;
  eachMaterial(rock, (m) => m.color.multiplyScalar(tint));
  g.add(rock);
  return g;
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
