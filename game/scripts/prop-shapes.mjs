// Writes src/data/prop-shapes.json: the collision boxes of every static prop model in public/models/.
// Each model's triangles are rasterized on a grid of CELL meters in model space. Every cell keeps the height
// slabs its geometry fills. Cells merge into boxes by height band, and then the boxes merge down to
// MAX_BOXES. Rerun after a prop model changes. The shape test fails while a stored hash differs from its .glb.
//
// Boxes are in model meters: x forward (Blender X), y sideways (Blender Y), z up (Blender Z).

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Vector3 } from 'three';

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
  'junk',
  'power_pole',
  'rock',
  'ruin_house',
  'shack',
  'silo',
  'tank_hulk',
  'water_tower',
  'wreck',
];

const OUT = 'src/data/prop-shapes.json';
const CELL = 0.5; // m, fine enough for a post or a fence rail, coarse enough to keep few boxes
const GROUND = 0.15; // m, geometry wholly below this, like a concrete apron or a ground skirt, never blocks a wheel
const GAP = 0.5; // m, a vertical gap narrower than this is filled, since nothing passes through it
const BAND = 0.5; // m, cells merge into one box when their slabs start and end in the same bands
const COST_HEIGHT = 2; // m, about a truck's height, see capBoxes()
const MAX_BOXES = 32; // keeps the ruin walls and the gas station posts apart, and still few colliders per prop (PC1)
const RAYS = 4; // rays per cell side, 12.5 cm apart, so no post or wall slips between them
const RAY_SHIFT = { x: 0.0137, y: 0.0291 }; // of the ray spacing, keeps rays off the round coordinates where model edges lie
const CM = 100;

const shapes = {};
for (const name of PROP_MODELS) {
  const bytes = readFileSync(`public/models/${name}.glb`);
  const boxes = capBoxes(mergeCells(rasterize(await loadTriangles(bytes))));
  shapes[name] = { hash: fnv1a(bytes), boxes: boxes.map(roundBox) };
  console.log(`${name}: ${boxes.length} boxes`);
}
writeFileSync(`${OUT}.tmp`, formatShapes(shapes));
renameSync(`${OUT}.tmp`, OUT);
console.log(`${OUT}: ${PROP_MODELS.length} models`);

// FNV-1a over the file bytes, as 8 hex digits. src/data/prop-shapes.test.ts repeats it.
function fnv1a(bytes) {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

// Every triangle of every mesh in model space. glTF is Y up, so glTF (x, y, z) is model (x, -z, y).
async function loadTriangles(bytes) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  gltf.scene.updateMatrixWorld(true);
  const tris = [];
  gltf.scene.traverse((o) => {
    if (o.isMesh) tris.push(...meshTriangles(o));
  });
  if (tris.length === 0) throw new Error('Model has no triangles');
  return tris;
}

function meshTriangles(mesh) {
  const pos = mesh.geometry.attributes.position;
  const index = mesh.geometry.index;
  const count = index ? index.count : pos.count;
  const corner = (i) => {
    const v = new Vector3().fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
    return { x: v.x, y: -v.z, z: v.y };
  };
  const tris = [];
  for (let i = 0; i < count; i += 3) tris.push([corner(i), corner(i + 1), corner(i + 2)]);
  return tris;
}

// Per cell "i,j", the height slabs of geometry over it, each with the ground extent of that geometry.
// Surfaces mark the cell where they cross it, and vertical rays fill the solid between a floor and its roof.
function rasterize(tris) {
  const raw = new Map();
  for (const tri of tris) {
    for (const [key, i, j, part] of triangleCells(tri)) {
      if (!raw.has(key)) raw.set(key, { i, j, parts: [], tris: [] });
      raw.get(key).parts.push(part);
      raw.get(key).tris.push(tri);
    }
  }
  const cells = new Map();
  for (const [key, cell] of raw) {
    const slabs = joinSlabs([...cell.parts, ...cellSolids(cell)]).filter((s) => s.z1 >= GROUND);
    if (slabs.length > 0) cells.set(key, slabs);
  }
  return cells;
}

function triangleCells(tri) {
  const out = [];
  const [i0, i1] = cellRange(tri.map((p) => p.x));
  const [j0, j1] = cellRange(tri.map((p) => p.y));
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const part = extentOf(clipToCell(tri, i, j));
      if (part) out.push([`${i},${j}`, i, j, part]);
    }
  }
  return out;
}

// The solid spans that vertical rays through the cell cross, each marked at its ray's ground point.
function cellSolids(cell) {
  const spans = [];
  for (let a = 0; a < RAYS; a++) {
    for (let b = 0; b < RAYS; b++) {
      const x = (cell.i + (a + 0.5 + RAY_SHIFT.x) / RAYS) * CELL;
      const y = (cell.j + (b + 0.5 + RAY_SHIFT.y) / RAYS) * CELL;
      spans.push(...raySolids(cell.tris, x, y));
    }
  }
  return spans;
}

// A ray going up enters the solid through a face that looks down and leaves through one that looks up.
// A count that does not return to zero means an open mesh, which has no inside.
function raySolids(tris, x, y) {
  const hits = tris.map((t) => rayHit(t, x, y)).filter((h) => h !== null).sort((p, q) => p.z - q.z);
  const spans = [];
  let depth = 0;
  let from = 0;
  for (const h of hits) {
    if (depth === 0) from = h.z;
    depth += h.step;
    if (depth === 0) spans.push({ x0: x, x1: x, y0: y, y1: y, z0: from, z1: h.z });
  }
  if (depth !== 0) throw new Error(`Open mesh under the ray at x ${x}, y ${y}`);
  return spans;
}

function rayHit(tri, x, y) {
  const [a, b, c] = tri;
  const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (Math.abs(area) < 1e-12) return null;
  const u = ((b.x - x) * (c.y - y) - (c.x - x) * (b.y - y)) / area;
  const v = ((c.x - x) * (a.y - y) - (a.x - x) * (c.y - y)) / area;
  const w = 1 - u - v;
  if (u < 0 || v < 0 || w < 0) return null;
  return { z: u * a.z + v * b.z + w * c.z, step: area > 0 ? -1 : 1 };
}

function cellRange(values) {
  return [Math.floor(Math.min(...values) / CELL), Math.floor(Math.max(...values) / CELL)];
}

// Clips a triangle to the cell, shrunk by a hair so faces lying on a cell edge mark only the cell they close.
function clipToCell(tri, i, j) {
  const e = 1e-4;
  let poly = tri;
  poly = clip(poly, (p) => p.x - (i * CELL + e));
  poly = clip(poly, (p) => (i + 1) * CELL - e - p.x);
  poly = clip(poly, (p) => p.y - (j * CELL + e));
  return clip(poly, (p) => (j + 1) * CELL - e - p.y);
}

// Sutherland-Hodgman: keeps the part of the polygon where inside(p) >= 0.
function clip(poly, inside) {
  const out = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k];
    const b = poly[(k + 1) % poly.length];
    const da = inside(a);
    const db = inside(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) out.push(lerp(a, b, da / (da - db)));
  }
  return out;
}

function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function extentOf(points) {
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const zs = points.map((p) => p.z);
  return {
    x0: Math.min(...xs), x1: Math.max(...xs),
    y0: Math.min(...ys), y1: Math.max(...ys),
    z0: Math.min(...zs), z1: Math.max(...zs),
  };
}

// Joins overlapping height spans, and spans closer than GAP, into slabs.
function joinSlabs(parts) {
  const sorted = [...parts].sort((a, b) => a.z0 - b.z0);
  const slabs = [{ ...sorted[0] }];
  for (const p of sorted.slice(1)) {
    const top = slabs[slabs.length - 1];
    if (p.z0 - top.z1 < GAP) Object.assign(top, union(top, p));
    else slabs.push({ ...p });
  }
  return slabs;
}

function union(a, b) {
  return {
    x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1),
    y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1),
    z0: Math.min(a.z0, b.z0), z1: Math.max(a.z1, b.z1),
  };
}

// Groups slabs by height band, then covers each band's cells with rectangles, greedy along x then y.
function mergeCells(cells) {
  const bands = new Map();
  for (const [key, slabs] of cells) {
    const [i, j] = key.split(',').map(Number);
    for (const s of slabs) {
      const band = `${Math.floor(s.z0 / BAND)},${Math.ceil(s.z1 / BAND)}`;
      if (!bands.has(band)) bands.set(band, new Map());
      bands.get(band).set(key, { i, j, slab: s });
    }
  }
  const boxes = [];
  for (const band of [...bands.keys()].sort()) boxes.push(...coverBand(bands.get(band)));
  return boxes;
}

function coverBand(cells) {
  const left = new Map(cells);
  const order = [...cells.values()].sort((a, b) => a.j - b.j || a.i - b.i);
  const boxes = [];
  for (const start of order) {
    if (!left.has(`${start.i},${start.j}`)) continue;
    boxes.push(takeRectangle(left, start));
  }
  return boxes;
}

function takeRectangle(left, start) {
  let iEnd = start.i;
  while (left.has(`${iEnd + 1},${start.j}`)) iEnd++;
  const rowFree = (j) => Array.from({ length: iEnd - start.i + 1 }, (_, k) => `${start.i + k},${j}`).every((key) => left.has(key));
  let jEnd = start.j;
  while (rowFree(jEnd + 1)) jEnd++;
  let box = null;
  for (let j = start.j; j <= jEnd; j++) {
    for (let i = start.i; i <= iEnd; i++) {
      const { slab } = left.get(`${i},${j}`);
      box = box ? union(box, slab) : { ...slab };
      left.delete(`${i},${j}`);
    }
  }
  return box;
}

// Merges the pair of boxes whose union adds the least empty volume, until MAX_BOXES remain. A post joins the
// roof above it before two posts join across the gap between them. Volume counts every box as at least
// COST_HEIGHT tall, since a low box across a lane blocks a wheel as much as a wall does.
function capBoxes(input) {
  const boxes = [...input];
  while (boxes.length > MAX_BOXES) {
    const [a, b] = cheapestPair(boxes);
    boxes[a] = union(boxes[a], boxes[b]);
    boxes.splice(b, 1);
  }
  return boxes;
}

function cheapestPair(boxes) {
  let best = null;
  for (let a = 0; a < boxes.length; a++) {
    for (let b = a + 1; b < boxes.length; b++) {
      const waste = costVolume(union(boxes[a], boxes[b])) - costVolume(boxes[a]) - costVolume(boxes[b]);
      if (best === null || waste < best.waste) best = { a, b, waste };
    }
  }
  return [best.a, best.b];
}

function costVolume(b) {
  return (b.x1 - b.x0) * (b.y1 - b.y0) * Math.max(b.z1 - b.z0, COST_HEIGHT);
}

// Rounds outward to whole centimeters, so a stored box never shrinks.
function roundBox(b) {
  const down = (v) => Math.floor(v * CM + 1e-6) / CM + 0;
  const up = (v) => Math.ceil(v * CM - 1e-6) / CM + 0;
  return { x0: down(b.x0), x1: up(b.x1), y0: down(b.y0), y1: up(b.y1), z0: down(b.z0), z1: up(b.z1) };
}

// One model per block and one box per line, sorted by name, so a rerun writes the same bytes.
function formatShapes(all) {
  const blocks = Object.keys(all).sort().map((name) => {
    const { hash, boxes } = all[name];
    const lines = boxes.map((b) => `      ${JSON.stringify(b)}`).join(',\n');
    return `  ${JSON.stringify(name)}: {\n    "hash": ${JSON.stringify(hash)},\n    "boxes": [\n${lines}\n    ]\n  }`;
  });
  return `{\n${blocks.join(',\n')}\n}\n`;
}
