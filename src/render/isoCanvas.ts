// Map-space canvases draped over the ground mesh. Canvas pixel (px, py) covers map point
// (from + px / res, from + py / res). The mesh lifts each vertex by the ground height through toScreen.

import Phaser from 'phaser';
import { toScreen } from './iso';

export type IsoCanvas = {
  ctx: CanvasRenderingContext2D;
  texture: Phaser.Textures.CanvasTexture;
  size: number; // canvas side in pixels
  res: number; // pixels per tile
  from: number; // map coordinate of the canvas top-left corner, same for x and y
  tiles: number; // map tiles covered on each axis
  toPx: (tiles: number) => number; // map coordinate to canvas pixel coordinate
};

export function makeMapCanvas(scene: Phaser.Scene, key: string, from: number, tiles: number, res: number): IsoCanvas {
  const size = Math.ceil(tiles * res);
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const texture = scene.textures.createCanvas(key, size, size);
  if (!texture) throw new Error(`Could not create canvas texture ${key}`);
  return { ctx: texture.getContext(), texture, size, res, from, tiles, toPx: (t) => (t - from) * res };
}

// Drapes the canvas over the ground as one mesh of step x step tile quads at the given depth.
export function drapeCanvas(scene: Phaser.Scene, c: IsoCanvas, step: number, depth: number): Phaser.GameObjects.Mesh2D {
  const n = Math.round(c.tiles / step);
  const vertices: number[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const s = toScreen(c.from + i * step, c.from + j * step);
      vertices.push(s.x, s.y, i / n, j / n);
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      indices.push(a, a + 1, a + n + 1, 0, a + 1, a + n + 2, a + n + 1, 0);
    }
  }
  // Canvas rows run top-down; Mesh2D expects GL's bottom-up texture rows unless flipV is set.
  return scene.add.mesh2d(0, 0, c.texture.key, vertices, indices, true).setRenderAsTriangles(true).setDepth(depth);
}
