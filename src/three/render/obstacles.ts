// Static map obstacles: rocks, wrecks, buildings, water. Synced by id, so wrecks that appear
// mid-game (a vehicle dying) get added without touching the rest.

import * as THREE from 'three';
import { hashStr } from '../../render/noise';
import { PAL, shade } from '../../render/palette';
import { PHYSICS } from '../../data/physics';
import { heightAt, type Terrain } from '../../sim/terrain';
import type { Obstacle } from '../../sim/types';

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

// A jagged low-poly boulder: two stacked dodecahedra shrinking toward a peak, like the 2D rock prism.
function buildRock(t: Terrain, o: Obstacle): THREE.Object3D {
  const seed = hashStr(o.id);
  const r = o.r * S;
  const tint = 0.9 + seed * 0.2;
  const g = seat(t, o);
  const base = new THREE.Mesh(
    new THREE.DodecahedronGeometry(r, 0),
    new THREE.MeshLambertMaterial({ color: shade(PAL.rock.top, tint), flatShading: true }),
  );
  base.scale.set(1, 0.55, 1);
  base.position.y = r * 0.3;
  base.rotation.y = seed * Math.PI * 2;
  const peak = new THREE.Mesh(
    new THREE.DodecahedronGeometry(r * 0.6, 0),
    new THREE.MeshLambertMaterial({ color: shade(PAL.rock.side, tint), flatShading: true }),
  );
  peak.scale.set(1, 0.6, 1);
  peak.position.y = r * 0.75;
  peak.rotation.y = seed * Math.PI * 3;
  g.add(base, peak);
  for (const m of g.children) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  return g;
}

// A burnt truck: scorched frame, crushed cab, one loose wheel, like the 2D wreck.
function buildWreck(t: Terrain, o: Obstacle): THREE.Object3D {
  const seed = hashStr(o.id);
  const k = o.r / 0.7; // scale relative to the 0.7-tile reference wreck the shape was drawn for
  const heading = seed * Math.PI * 2;
  const g = seat(t, o);
  g.rotation.y = -heading;
  const rust = new THREE.MeshLambertMaterial({ color: PAL.rust.top, flatShading: true });
  const rustDark = new THREE.MeshLambertMaterial({ color: PAL.rust.dark, flatShading: true });
  const bed = new THREE.Mesh(new THREE.BoxGeometry(1.1 * k * S, 0.5 * S, 0.8 * k * S), rust);
  bed.position.set(-0.3 * k * S, 0.3 * S, 0);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.5 * k * S, 0.3 * S, 0.6 * k * S), rustDark);
  cab.position.set(-0.45 * k * S, 0.55 * S, 0);
  cab.rotation.z = 0.15;
  const wheel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16 * S, 0.16 * S, 0.12 * S, 12).rotateX(Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: PAL.wheel }),
  );
  wheel.position.set(0.3 * k * S, 0.16 * S, 0.75 * k * S);
  wheel.rotation.z = 0.6;
  g.add(bed, cab, wheel);
  for (const m of g.children) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  return g;
}

// A blocky building with a peaked roof cap. Random roof color per id, like the 2D version.
function buildBuilding(t: Terrain, o: Obstacle): THREE.Object3D {
  const seed = hashStr(o.id);
  const size = o.r * 0.78 * 2 * S; // full footprint, in meters
  const height = (16 + seed * 20) * (S / 45); // 45px per height unit in the 2D relief scale
  const roof = PAL.roof[Math.floor(seed * 97) % PAL.roof.length];
  const g = seat(t, o);
  g.rotation.y = -seed * Math.PI;
  const wall = new THREE.Mesh(new THREE.BoxGeometry(size, height, size * 0.85), new THREE.MeshLambertMaterial({ color: PAL.wall.top, flatShading: true }));
  wall.position.y = height / 2;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(size * 1.08, height * 0.12, size * 0.95), new THREE.MeshLambertMaterial({ color: roof, flatShading: true }));
  cap.position.y = height + (height * 0.12) / 2;
  g.add(wall, cap);
  for (const m of g.children) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  return g;
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
