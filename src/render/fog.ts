// Fog of war overlay: dark for tiles never seen, dimmed for explored but not currently visible,
// clear for tiles visible now. One canvas pixel per tile; texture filtering softens the edges.

import Phaser from 'phaser';
import { TERRAIN } from '../data/terrain';
import type { World } from '../sim/types';
import { drapeCanvas, makeMapCanvas, type IsoCanvas } from './isoCanvas';
import { PAL } from './palette';

const FOG_DEPTH = 9e5;

const FOG_STEP = 1; // tiles per fog mesh quad

export function makeFog(scene: Phaser.Scene, size: number): IsoCanvas {
  const c = makeMapCanvas(scene, 'fog', 0, size, 1);
  drapeCanvas(scene, c, FOG_STEP, FOG_DEPTH);
  return c;
}

export function drawFog(c: IsoCanvas, world: World, visible: Set<number>): void {
  const size = world.size;
  const img = c.ctx.createImageData(c.size, c.size);
  for (let idx = 0; idx < size * size; idx++) {
    const alpha = visible.has(idx) ? 0 : world.player.explored[idx] ? TERRAIN.fog.dimAlpha : TERRAIN.fog.darkAlpha;
    img.data[idx * 4] = (PAL.bg >> 16) & 0xff;
    img.data[idx * 4 + 1] = (PAL.bg >> 8) & 0xff;
    img.data[idx * 4 + 2] = PAL.bg & 0xff;
    img.data[idx * 4 + 3] = Math.round(alpha * 255);
  }
  c.ctx.putImageData(img, 0, 0);
  c.texture.refresh();
}
