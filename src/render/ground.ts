// Ground lift for rendering: terrain height in screen pixels.

import { TERRAIN } from '../data/terrain';
import { heightAt, type Terrain } from '../sim/terrain';

export function groundLiftOf(t: Terrain): (x: number, y: number) => number {
  return (x, y) => heightAt(t, x, y) * TERRAIN.reliefPx;
}
