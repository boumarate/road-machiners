// Ground painted from the terrain grid: tile type colors, hillshade from tile slopes, roads and scatter.
// The painting is draped over one mesh whose vertices are the grid corners.
// The canvas painting itself lives in groundPaint.ts, shared with the 3D terrain mesh.

import Phaser from 'phaser';
import type { Terrain } from '../sim/terrain';
import { drapeCanvas, makeMapCanvas } from './isoCanvas';
import { paintGroundCanvas, TERRAIN_MARGIN } from './groundPaint';

export { TERRAIN_MARGIN };
const MARGIN = TERRAIN_MARGIN;
const RES = 6; // canvas pixels per tile
const MESH_STEP = 1; // one mesh quad per tile, so vertices sit exactly on grid corners
const GROUND_DEPTH = -1e6;

// Call after setGroundLift, so the mesh follows the relief.
export function drawTerrain(scene: Phaser.Scene, t: Terrain): void {
  const c = makeMapCanvas(scene, 'terrain', -MARGIN, t.size + 2 * MARGIN, RES);
  paintGroundCanvas(c, t);
  c.texture.refresh();
  drapeCanvas(scene, c, MESH_STEP, GROUND_DEPTH);
}
