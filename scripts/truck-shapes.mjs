// Writes src/data/truck-shapes.json: the collision boxes of every base_* truck model in public/models/.
// scripts/shape-lib.mjs explains how boxes come from a model. Rerun after a base model changes.
// The shape test fails while a stored hash differs from its .glb.
//
// Each model also gets a height map of its top surface, top[i][j] in whole centimeters, null where there is no geometry.
// Boxes and heights are in model meters with the origin at the truck's collider center: x forward, y to the truck's left, z up.

import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fnv1a, formatShapes, heightMap, loadTriangles, shapeOf } from './shape-lib.mjs';

const OUT = 'src/data/truck-shapes.json';
const CFG = {
  cell: 0.25, // m, fine enough for a fender and a hood step
  ground: -Infinity, // the whole body collides, down to the skirt
  gap: 0.25, // m, a vertical gap narrower than this is filled
  band: 0.25, // m, cells merge into one box when their slabs start and end in the same bands
  costHeight: 1, // m, about a truck body's height
  maxBoxes: 12, // few colliders per truck, since every truck near the player has a body (PC1)
  rays: 4,
  rayShift: { x: 0.0137, y: 0.0291 },
};

const HEIGHT_CELL = 0.1; // m, spacing of the top surface height map

const names = readdirSync('public/models').filter((f) => /^base_.*\.glb$/.test(f)).map((f) => f.replace('.glb', '')).sort();
const shapes = {};
for (const name of names) {
  const bytes = readFileSync(`public/models/${name}.glb`);
  const tris = await loadTriangles(bytes);
  const boxes = shapeOf(tris, CFG);
  shapes[name] = { hash: fnv1a(bytes), boxes, heights: heightMap(tris, HEIGHT_CELL) };
  console.log(`${name}: ${boxes.length} boxes`);
}
writeFileSync(`${OUT}.tmp`, formatShapes(shapes));
renameSync(`${OUT}.tmp`, OUT);
console.log(`${OUT}: ${names.length} models`);
