// Every gun's riser post starts on the base model. The post stands at the footprint center, at the highest row surface
// under the gun, so the model must reach that height at the center.

import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../../data/chassis';
import { PARTS } from '../../data/parts';
import { PHYSICS } from '../../data/physics';
import { cellCenter } from '../../sim/body';
import SHAPES from '../../data/truck-shapes.json';
import { baseGrid, itemCells } from '../../sim/grid';
import type { GridItem } from '../../sim/types';
import { loadModels } from './models';
import { weaponStand } from './vehicle';

const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?inline', import: 'default', eager: true });
await loadModels(async (name) => {
  const url = FILES[`/public/models/${name}.glb`];
  if (!url) throw new Error(`Missing model file for ${name}`);
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
});

const GUNS = Object.values(PARTS).filter((def) => def.kind === 'weapon');
const TOLERANCE = 0.02; // meters; the models are authored on a 0.01 grid

describe('gun risers', () => {
  it.each(Object.keys(CHASSIS))('%s: a post on any deck spot starts on the model', (id) => {
    const boxes = SHAPES[`base_${id}` as keyof typeof SHAPES].boxes;
    const cells = baseGrid(id).cells;
    const floating: string[] = [];
    for (const def of GUNS) {
      for (const rot of [0, 1] as const) {
        for (let y = 0; y < cells.length; y++) {
          for (let x = 0; x < cells[y].length; x++) {
            const item = { id: 'g', kind: 'part', x, y, rot, part: { id: 'p', defId: def.id, hp: 1, wear: 0 } } as unknown as GridItem;
            if (!itemCells(item).every((c) => cells[c.y]?.[c.x] === 'D')) continue;
            const { at: { pos }, bottom } = weaponStand({ chassisId: id }, item);
            // Shape boxes number the truck's left as +y, and 3D space as -z.
            const under = boxes.filter((b) => pos.x >= b.x0 && pos.x <= b.x1 && -pos.z >= b.y0 && -pos.z <= b.y1);
            const bodyTop = Math.max(-Infinity, ...under.map((b) => b.z1));
            const centers = itemCells(item).map((c) => cellCenter(id, c.x, c.y).x);
            const along = PHYSICS.cell.along;
            if (pos.x < Math.min(...centers) - along || pos.x > Math.max(...centers) + along) floating.push(`${def.id} rot ${rot} at ${x},${y}: post is more than a cell off its cells`);
            if (bodyTop < bottom - TOLERANCE) floating.push(`${def.id} rot ${rot} at ${x},${y}: post starts at ${bottom.toFixed(2)}, model top is ${bodyTop.toFixed(2)}`);
          }
        }
      }
    }
    expect(floating).toEqual([]);
  });
});
