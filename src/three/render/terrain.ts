// The terrain mesh: one quad per tile, corner heights and colors from the sim grid.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { TERRAIN_TYPES } from '../../data/terrain';
import { terrainIndices } from '../../phys/drive';
import type { World } from '../../sim/types';

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
