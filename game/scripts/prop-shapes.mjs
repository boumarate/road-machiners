// Writes src/data/prop-shapes.json: the collision boxes of every static prop model in public/models/.
// scripts/shape-lib.mjs explains how boxes come from a model. Rerun after a prop model changes.
// The shape test fails while a stored hash differs from its .glb.

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fnv1a, formatShapes, loadTriangles, shapeOf } from './shape-lib.mjs';

// Every model a static prop view draws: landmark looks, buildings, wrecks, rocks and junk piles.
// Site decor keeps its circle, so its models are not here.
const PROP_MODELS = [
  'billboard',
  'bridge_broken',
  'building',
  'crag',
  'crates',
  'fence',
  'gas_station',
  'hull_chunk',
  'hull_drum',
  'hull_gantry',
  'hull_shard',
  'hull_shell',
  'hull_tower',
  'junk',
  'power_pole',
  'reactor',
  'rim_rock',
  'rock',
  'ruin_house',
  'shack',
  'ship_bow',
  'ship_cage',
  'ship_hub',
  'silo',
  'tank_hulk',
  'water_tower',
  'wreck',
];

const OUT = 'src/data/prop-shapes.json';
const CFG = {
  cell: 0.5, // m, fine enough for a post or a fence rail, coarse enough to keep few boxes
  ground: 0.15, // m, geometry wholly below this, like a concrete apron or a ground skirt, never blocks a wheel
  gap: 0.5, // m, a vertical gap narrower than this is filled, since nothing passes through it
  band: 0.5, // m, cells merge into one box when their slabs start and end in the same bands
  costHeight: 2, // m, about a truck's height, see capBoxes()
  maxBoxes: 32, // keeps the ruin walls and the gas station posts apart, and still few colliders per prop (PC1)
  rays: 4, // rays per cell side, 12.5 cm apart, so no post or wall slips between them
  rayShift: { x: 0.0137, y: 0.0291 },
};

const shapes = {};
for (const name of PROP_MODELS) {
  const bytes = readFileSync(`public/models/${name}.glb`);
  const boxes = shapeOf(await loadTriangles(bytes), CFG);
  shapes[name] = { hash: fnv1a(bytes), boxes };
  console.log(`${name}: ${boxes.length} boxes`);
}
writeFileSync(`${OUT}.tmp`, formatShapes(shapes));
renameSync(`${OUT}.tmp`, OUT);
console.log(`${OUT}: ${PROP_MODELS.length} models`);

