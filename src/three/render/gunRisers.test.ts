// Every gun's riser post starts on the model's surface under the gun and stands inside the gun's footprint.

import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../../data/chassis';
import { PARTS } from '../../data/parts';
import { cellRect, surfaceAt } from '../../sim/body';
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
const TOLERANCE = 0.02; // meters

describe('gun risers', () => {
  it.each(Object.keys(CHASSIS))('%s: a post on any deck spot stands on the surface inside the gun footprint', (id) => {
    const cells = baseGrid(id).cells;
    const problems: string[] = [];
    for (const def of GUNS) {
      for (const rot of [0, 1] as const) {
        for (let y = 0; y < cells.length; y++) {
          for (let x = 0; x < cells[y].length; x++) {
            const item = { id: 'g', kind: 'part', x, y, rot, part: { id: 'p', defId: def.id, hp: 1, wear: 0 } } as unknown as GridItem;
            if (!itemCells(item).every((c) => cells[c.y]?.[c.x] === 'D')) continue;
            const { at: { pos }, bottom } = weaponStand({ chassisId: id }, item);
            const rect = cellRect(id, itemCells(item));
            const label = `${def.id} rot ${rot} at ${x},${y}`;
            const surface = surfaceAt(id, rect);
            if (Math.abs(bottom - surface) > TOLERANCE) problems.push(`${label}: post starts at ${bottom.toFixed(2)}, surface is ${surface.toFixed(2)}`);
            if (pos.x < rect.x0 || pos.x > rect.x1 || pos.z < rect.z0 || pos.z > rect.z1) problems.push(`${label}: post at ${pos.x.toFixed(2)},${pos.z.toFixed(2)} is outside its rect`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
