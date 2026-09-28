import * as THREE from "three";
import { PHYSICS } from "../../data/physics";
import {
  paintGroundCanvas,
  TERRAIN_MARGIN,
  type PaintCanvas,
} from "../../render/groundPaint";
import type { Terrain } from "../../sim/terrain";
import type { World } from "../../sim/types";
import { drawRoads } from "./roads";
import type { RenderScope } from "./scope";

const S = PHYSICS.metersPerTile;
const TEXTURE_SIDE = 2048; // 16 MiB RGBA before mipmaps, independent of region area.
export const TERRAIN_CHUNK = 32; // Roughly two normal camera widths, allowing offscreen terrain culling.

// A canvas over the whole map and its margin, one per ground layer.
function mapCanvas(w: World): PaintCanvas {
  const from = -TERRAIN_MARGIN;
  const res = TEXTURE_SIDE / (w.size + 2 * TERRAIN_MARGIN);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TEXTURE_SIDE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not get terrain canvas context");
  return {
    ctx,
    size: TEXTURE_SIDE,
    res,
    from,
    toPx: (tile) => (tile - from) * res,
  };
}

function paintTexture(w: World): THREE.CanvasTexture {
  const c = mapCanvas(w);
  paintGroundCanvas(c, w.terrain, { hillshade: 0.35 });
  const texture = new THREE.CanvasTexture(c.ctx.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Canvas row 0 is map y at the top edge, and the UVs grow with map y, so the image must not be flipped.
  texture.flipY = false;
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

// Height of the drawn ground at a map point. Each tile is two triangles split on the diagonal from its
// (x, y + 1) corner to its (x + 1, y) corner, as the chunk planes are built. Meshes laid on the ground use
// this rather than the sim's bilinear height, so they neither float over nor sink under a tile's crease.
export function meshHeightAt(t: Terrain, x: number, y: number): number {
  const i = Math.min(Math.max(Math.floor(x), 0), t.size - 1);
  const j = Math.min(Math.max(Math.floor(y), 0), t.size - 1);
  const fx = Math.min(Math.max(x - i, 0), 1);
  const fy = Math.min(Math.max(y - j, 0), 1);
  const n = t.size + 1;
  const a = t.heights[j * n + i];
  const b = t.heights[(j + 1) * n + i];
  const c = t.heights[(j + 1) * n + i + 1];
  const d = t.heights[j * n + i + 1];
  if (fx + fy <= 1) return a + (d - a) * fx + (b - a) * fy;
  return c + (b - c) * (1 - fx) + (d - c) * (1 - fy);
}

// The ground map's uv per meter. The map spans the world plus TERRAIN_MARGIN tiles on each side.
export function groundUvPerMeter(size: number): number {
  return 1 / ((size + 2 * TERRAIN_MARGIN) * S);
}

export type TerrainChunk = {
  x: number;
  y: number;
  width: number;
  depth: number;
  mesh: THREE.Mesh;
};

// Terrain chunks register with the scope, so only chunks near the view are drawn. Returned for the fog,
// which greys out the ground per corner. Roads are part of the ground material.
export function terrainMesh(w: World, scope: RenderScope): TerrainChunk[] {
  const chunks: TerrainChunk[] = [];
  const material = new THREE.MeshLambertMaterial({ map: paintTexture(w) });
  drawRoads(material, mapCanvas(w));
  for (let y = 0; y < w.size; y += TERRAIN_CHUNK)
    for (let x = 0; x < w.size; x += TERRAIN_CHUNK) {
      const width = Math.min(TERRAIN_CHUNK, w.size - x);
      const depth = Math.min(TERRAIN_CHUNK, w.size - y);
      const geo = new THREE.PlaneGeometry(
        width * S,
        depth * S,
        width,
        depth,
      ).rotateX(-Math.PI / 2);
      const pos = geo.getAttribute("position");
      const uv = geo.getAttribute("uv");
      for (let j = 0; j <= depth; j++)
        for (let i = 0; i <= width; i++) {
          const k = j * (width + 1) + i;
          pos.setXYZ(
            k,
            (x + i) * S,
            w.terrain.heights[(y + j) * (w.size + 1) + x + i] * S,
            (y + j) * S,
          );
          uv.setXY(
            k,
            (x + i + TERRAIN_MARGIN) / (w.size + TERRAIN_MARGIN * 2),
            (y + j + TERRAIN_MARGIN) / (w.size + TERRAIN_MARGIN * 2),
          );
        }
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      scope.add(
        mesh,
        { x: x + width / 2, y: y + depth / 2 },
        Math.hypot(width, depth) / 2,
      );
      chunks.push({ x, y, width, depth, mesh });
    }
  return chunks;
}
