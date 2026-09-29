// The shape of a grid cell on screen. A real cell is longer than it is wide, so every truck grid view draws it taller than wide.

import { PHYSICS } from "../data/physics";

export type CellPx = { w: number; h: number };

export function cellPx(width: number): CellPx {
  return { w: width, h: (width * PHYSICS.cell.along) / PHYSICS.cell.across };
}
