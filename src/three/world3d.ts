// Static 3D scenery: the terrain mesh and obstacle props, built from the sim world.

import * as THREE from 'three';
import { TERRAIN_TYPES } from '../data/terrain';
import { PHYSICS } from '../data/physics';
import { terrainIndices } from '../phys/drive';
import { heightAt } from '../sim/terrain';
import type { Obstacle, World } from '../sim/types';
import { PAL } from '../render/palette';

const S = PHYSICS.metersPerTile;

// Corner colors average the types of the tiles around each corner, so type borders blend.
export function terrainMesh(w: World): THREE.Mesh {
  const t = w.terrain;
  const n = t.size;
  const pos = new Float32Array((n + 1) * (n + 1) * 3);
  const col = new Float32Array((n + 1) * (n + 1) * 3);
  const c = new THREE.Color();
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const k = (j * (n + 1) + i) * 3;
      pos.set([i * S, t.heights[j * (n + 1) + i] * S, j * S], k);
      let r = 0, g = 0, b = 0, count = 0;
      for (const [x, y] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) {
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        c.setHex(TERRAIN_TYPES[t.types[y * n + x]].color);
        r += c.r; g += c.g; b += c.b; count++;
      }
      col.set([r / count, g / count, b / count], k);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(terrainIndices(n), 1));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  return mesh;
}

export function obstacleProps(w: World): THREE.Group {
  const group = new THREE.Group();
  for (const o of w.obstacles) group.add(prop(w, o));
  return group;
}

function prop(w: World, o: Obstacle): THREE.Object3D {
  const ground = heightAt(w.terrain, o.pos.x, o.pos.y) * S;
  const r = o.r * S;
  let mesh: THREE.Mesh;
  if (o.kind === 'rock') {
    mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), new THREE.MeshLambertMaterial({ color: PAL.rock.top, flatShading: true }));
    mesh.scale.y = 0.7;
    mesh.position.set(o.pos.x * S, ground + r * 0.3, o.pos.y * S);
    mesh.rotation.y = o.pos.x * 7.1 + o.pos.y * 3.3;
  } else if (o.kind === 'wreck') {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(r * 1.8, r * 0.6, r * 1.1), new THREE.MeshLambertMaterial({ color: PAL.rust.top }));
    mesh.position.set(o.pos.x * S, ground + r * 0.3, o.pos.y * S);
    mesh.rotation.set(0.1, o.pos.x * 5.3, 0.15);
  } else if (o.kind === 'building') {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(r * 1.4, 3.5, r * 1.4), new THREE.MeshLambertMaterial({ color: PAL.wall.top }));
    mesh.position.set(o.pos.x * S, ground + 1.75, o.pos.y * S);
  } else {
    mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.3, 24), new THREE.MeshLambertMaterial({ color: PAL.water }));
    mesh.position.set(o.pos.x * S, ground + 0.1, o.pos.y * S);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
