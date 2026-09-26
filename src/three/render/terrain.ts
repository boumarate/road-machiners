// The terrain mesh: one quad per tile, corner heights from the sim grid.
// The ground surface is a painted canvas texture (tile colors, road ruts, pebbles, scrub) so the
// 3D map keeps the blocky, hand-painted look of the old 2D game instead of smooth vertex colors.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { paintGroundCanvas, TERRAIN_MARGIN, type PaintCanvas } from '../../render/groundPaint';
import { terrainIndices } from '../../phys/drive';
import type { World } from '../../sim/types';

const S = PHYSICS.metersPerTile;
const RES = 12; // canvas pixels per tile; higher than the 2D game's since the 3D camera gets closer
// Scene lighting (hemisphere + directional sun) already shades slopes, so the painted hillshade
// is softened here to avoid doubling up with the real lighting.
const HILLSHADE_STRENGTH = 0.35;

// Builds a map-space canvas covering the map plus its margin, at RES pixels per tile.
function paintTexture(w: World): THREE.CanvasTexture {
  const t = w.terrain;
  const from = -TERRAIN_MARGIN;
  const tiles = t.size + 2 * TERRAIN_MARGIN;
  const size = Math.ceil(tiles * RES);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D context for terrain canvas');
  const c: PaintCanvas = { ctx, size, res: RES, from, toPx: (tile) => (tile - from) * RES };
  paintGroundCanvas(c, t, { hillshade: HILLSHADE_STRENGTH });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter; // keep painted pixels crisp instead of blurring them
  texture.minFilter = THREE.LinearMipmapLinearFilter; // still filter minification, ground recedes into the distance
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export function terrainMesh(w: World): THREE.Mesh {
  const t = w.terrain;
  const n = t.size;
  const from = -TERRAIN_MARGIN;
  const tiles = n + 2 * TERRAIN_MARGIN;
  const pos = new Float32Array((n + 1) * (n + 1) * 3);
  const uv = new Float32Array((n + 1) * (n + 1) * 2);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const k = (j * (n + 1) + i) * 3;
      pos.set([i * S, t.heights[j * (n + 1) + i] * S, j * S], k);
      const uvk = (j * (n + 1) + i) * 2;
      // UVs map map-space coordinates onto the painted canvas, which extends TERRAIN_MARGIN past the map edge.
      uv.set([(i - from) / tiles, (j - from) / tiles], uvk);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(terrainIndices(n), 1));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: paintTexture(w) }));
  mesh.receiveShadow = true;
  return mesh;
}
