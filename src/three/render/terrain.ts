import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { paintGroundCanvas, TERRAIN_MARGIN, type PaintCanvas } from '../../render/groundPaint';
import type { World } from '../../sim/types';
import type { RenderScope } from './scope';

const S = PHYSICS.metersPerTile;
const TEXTURE_RES = 6; // texture pixels per tile side, so every tile is a clean block and roads stay smooth
export const TERRAIN_CHUNK = 32; // Roughly two normal camera widths, allowing offscreen terrain culling.

function paintTexture(w: World): THREE.CanvasTexture {
  const from = -TERRAIN_MARGIN;
  const res = TEXTURE_RES;
  const side = res * (w.size + 2 * TERRAIN_MARGIN);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = side;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get terrain canvas context');
  const c: PaintCanvas = { ctx, size: side, res, from, toPx: (tile) => (tile - from) * res };
  paintGroundCanvas(c, w.terrain, { hillshade: 0.35 });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

export type TerrainChunk = { x: number; y: number; width: number; depth: number; mesh: THREE.Mesh };

// Terrain chunks register with the scope, so only chunks near the view are drawn. Returned for the fog,
// which greys out the ground per corner.
export function terrainMesh(w: World, scope: RenderScope): TerrainChunk[] {
  const chunks: TerrainChunk[] = [];
  const material = new THREE.MeshLambertMaterial({ map: paintTexture(w) });
  for (let y = 0; y < w.size; y += TERRAIN_CHUNK) for (let x = 0; x < w.size; x += TERRAIN_CHUNK) {
    const width = Math.min(TERRAIN_CHUNK, w.size - x);
    const depth = Math.min(TERRAIN_CHUNK, w.size - y);
    const geo = new THREE.PlaneGeometry(width * S, depth * S, width, depth).rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position');
    const uv = geo.getAttribute('uv');
    for (let j = 0; j <= depth; j++) for (let i = 0; i <= width; i++) {
      const k = j * (width + 1) + i;
      pos.setXYZ(k, (x + i) * S, w.terrain.heights[(y + j) * (w.size + 1) + x + i] * S, (y + j) * S);
      uv.setXY(k, (x + i + TERRAIN_MARGIN) / (w.size + TERRAIN_MARGIN * 2), (y + j + TERRAIN_MARGIN) / (w.size + TERRAIN_MARGIN * 2));
    }
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    scope.add(mesh, { x: x + width / 2, y: y + depth / 2 }, Math.hypot(width, depth) / 2);
    chunks.push({ x, y, width, depth, mesh });
  }
  return chunks;
}
