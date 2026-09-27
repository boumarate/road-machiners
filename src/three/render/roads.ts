// Roads drawn as strips laid on the ground. Each strip has a worn edge, an uneven width, two ruts that
// wander a little and patches of lighter and darker dirt. Where roads meet, one worn patch covers the
// crossing, and the ruts fade out before it. Strips end at site edges, where pads take over, and at the
// ends of Canyon Bridge, whose deck is its own model.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { REGION } from '../../data/region';
import { PAL, mix, shade } from '../../render/palette';
import { valueNoise } from '../../render/noise';
import { bridgeCut, deckAlong } from '../../sim/bridge';
import type { Terrain } from '../../sim/terrain';
import { INDEX_CELL, RoadIndex } from '../../sim/road-index';
import { dist, type Vec } from '../../sim/vec';
import type { RenderScope } from './scope';
import { meshHeightAt } from './terrain';

const S = PHYSICS.metersPerTile;
const SITES = [...REGION.towns, ...REGION.locations];
const HALF = REGION.roadWidth / 2;
const STEP = 0.5; // tiles between strip rows
const PIECE = 32; // rows per mesh, so a road draws only where the camera looks
const LIFT = 0.02; // tiles above the drawn ground; the material's depth offset does the rest
const JUNCTION_RADIUS = REGION.roadWidth * 0.62;
const RUT_FADE = 4; // tiles past a crossing patch over which ruts come back

// Across the strip, as shares of its half-width. Ruts shift sideways together with the wander.
type Column = { at: number; rut: boolean; edge: boolean; color: number };
const EDGE = shade(PAL.road, 1.05);
// Loose dust that drifts over the road in blotches.
const DUST = PAL.sand[3];
const CROWN = shade(PAL.road, 1.04);
const COLUMNS: Column[] = [
  { at: -1, rut: false, edge: true, color: EDGE },
  { at: -0.86, rut: false, edge: false, color: PAL.road },
  { at: -0.52, rut: false, edge: false, color: PAL.road },
  { at: -0.44, rut: true, edge: false, color: PAL.roadRut },
  { at: -0.36, rut: false, edge: false, color: PAL.road },
  { at: 0, rut: false, edge: false, color: CROWN },
  { at: 0.36, rut: false, edge: false, color: PAL.road },
  { at: 0.44, rut: true, edge: false, color: PAL.roadRut },
  { at: 0.52, rut: false, edge: false, color: PAL.road },
  { at: 0.86, rut: false, edge: false, color: PAL.road },
  { at: 1, rut: false, edge: true, color: EDGE },
];

type Row = { pos: Vec; side: Vec; half: number; fray: [number, number]; wander: number; tone: number; ruts: number };

export function addRoads(t: Terrain, scope: RenderScope): void {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const patchMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const crossings = junctions(REGION.roads);
  REGION.roads.forEach((road, r) => {
    for (const run of drawnRuns(rows(road, r, crossings))) {
      for (let first = 0; first < run.length - 1; first += PIECE) {
        const piece = run.slice(first, first + PIECE + 1);
        scope.add(new THREE.Mesh(stripGeometry(t, piece, r), material), piece[Math.floor(piece.length / 2)].pos, (piece.length * STEP) / 2 + HALF * 1.3);
      }
    }
  });
  crossings.forEach((c, k) => scope.add(new THREE.Mesh(patchGeometry(t, c, k), patchMaterial), c, JUNCTION_RADIUS * 1.3));
}

// Rows every STEP tiles along the road, with the look noise sampled along its length.
function rows(road: readonly Vec[], r: number, crossings: Vec[]): Row[] {
  const points = evenPoints(road);
  // Rows this many steps apart set the direction, so small kinks in the line do not twist the strip.
  const reach = 3;
  return points.map((pos, k) => {
    const ahead = points[Math.min(points.length - 1, k + reach)];
    const behind = points[Math.max(0, k - reach)];
    const d = dist(behind, ahead);
    const s = k * STEP;
    const near = Math.min(Infinity, ...crossings.map((c) => dist(c, pos)));
    return {
      pos,
      side: { x: -(ahead.y - behind.y) / d, y: (ahead.x - behind.x) / d },
      half: HALF * (0.78 + 0.22 * valueNoise(s / 23, r * 17.3)),
      fray: [1 + 0.3 * (valueNoise(s / 3.5, r * 5 + 3) - 0.5), 1 + 0.3 * (valueNoise(s / 3.5, r * 5 + 40) - 0.5)],
      wander: 0.14 * (valueNoise(s / 9, r * 3 + 1) - 0.5),
      tone: 0.9 + 0.16 * valueNoise(s / 11, r * 7 + 2),
      ruts: Math.min(1, Math.max(0, (near - JUNCTION_RADIUS) / RUT_FADE)),
    };
  });
}

// Stretches of rows off sites and off the bridge gap.
function drawnRuns(all: Row[]): Row[][] {
  const runs: Row[][] = [];
  let run: Row[] = [];
  for (const row of all) {
    if (drawn(row.pos)) {
      run.push(row);
      continue;
    }
    if (run.length > 1) runs.push(run);
    run = [];
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

function drawn(p: Vec): boolean {
  if (deckAlong(p.x, p.y) !== null || bridgeCut(p.x, p.y) > 0) return false;
  return !SITES.some((site) => dist(site.pos, p) < site.radius);
}

function stripGeometry(t: Terrain, piece: Row[], r: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  for (const row of piece) {
    for (const col of COLUMNS) {
      const across = row.half * columnAt(row, col);
      const x = row.pos.x + row.side.x * across;
      const y = row.pos.y + row.side.y * across;
      positions.push(x * S, (meshHeightAt(t, x, y) + LIFT + r * 0.002) * S, y * S);
      color.setHex(mix(col.rut ? mix(PAL.road, col.color, row.ruts) : col.color, DUST, dustAt(x, y))).multiplyScalar(row.tone);
      colors.push(color.r, color.g, color.b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(gridIndex(piece.length, COLUMNS.length));
  geo.computeVertexNormals();
  return geo;
}

// Share of dust over the road at a map point: none on most of it, up to a half in blotches.
function dustAt(x: number, y: number): number {
  return Math.max(0, valueNoise(x / 3.5, y / 3.5) - 0.55);
}

function columnAt(row: Row, col: Column): number {
  if (col.edge) return col.at * row.fray[col.at < 0 ? 0 : 1];
  if (col.at === 0 || Math.abs(col.at) > 0.8) return col.at;
  return col.at + row.wander;
}

// Two triangles per cell of a rows x cols vertex grid, facing up for a strip whose columns run from
// its left side to its right side.
function gridIndex(rowCount: number, cols: number): number[] {
  const index: number[] = [];
  for (let i = 0; i + 1 < rowCount; i++)
    for (let j = 0; j + 1 < cols; j++) {
      const a = i * cols + j;
      const b = a + cols;
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  return index;
}

// A worn disc over a crossing: rings of vertices out to a ragged rim.
function patchGeometry(t: Terrain, c: Vec, k: number): THREE.BufferGeometry {
  const spokes = 24;
  const rings = [0, 0.5, 0.85, 1];
  const ringColor = [shade(PAL.road, 1.03), PAL.road, PAL.road, EDGE];
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  rings.forEach((ring, i) => {
    for (let a = 0; a < spokes; a++) {
      const angle = (a / spokes) * Math.PI * 2;
      const rim = JUNCTION_RADIUS * (1 + 0.3 * (valueNoise(a * 0.7, k * 11 + 5) - 0.5));
      const x = c.x + Math.cos(angle) * rim * ring;
      const y = c.y + Math.sin(angle) * rim * ring;
      positions.push(x * S, (meshHeightAt(t, x, y) + LIFT * 1.5) * S, y * S);
      color.setHex(ringColor[i]);
      colors.push(color.r, color.g, color.b);
    }
  });
  const index: number[] = [];
  for (let i = 0; i + 1 < rings.length; i++)
    for (let a = 0; a < spokes; a++) {
      const p = i * spokes + a;
      const q = i * spokes + ((a + 1) % spokes);
      index.push(p, q, p + spokes, q, q + spokes, p + spokes);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

// Points where two roads touch outside sites: crossings and junctions. Touching stretches along one road
// count once, at their middle.
export function junctions(roads: Vec[][]): Vec[] {
  const found: Vec[] = [];
  const indexes = roads.map((road) => new RoadIndex([road], INDEX_CELL));
  roads.forEach((road, r) => {
    indexes.forEach((other, o) => {
      if (o <= r) return;
      for (const p of touching(road, other)) if (!found.some((f) => dist(f, p) < REGION.roadWidth)) found.push(p);
    });
  });
  return found.filter((p) => drawn(p));
}

function touching(road: readonly Vec[], other: RoadIndex): Vec[] {
  const out: Vec[] = [];
  let stretch: Vec[] = [];
  for (const p of evenPoints(road)) {
    if (other.nearestWithin(p.x, p.y, 1) < 1) {
      stretch.push(p);
      continue;
    }
    if (stretch.length > 0) out.push(stretch[Math.floor(stretch.length / 2)]);
    stretch = [];
  }
  if (stretch.length > 0) out.push(stretch[Math.floor(stretch.length / 2)]);
  return out;
}

// Points every STEP tiles along a road from its start, and its end.
function evenPoints(road: readonly Vec[]): Vec[] {
  const out: Vec[] = [road[0]];
  let carry = 0;
  for (let i = 1; i < road.length; i++) {
    const a = road[i - 1];
    const b = road[i];
    const d = dist(a, b);
    for (let s = STEP - carry; s <= d; s += STEP) out.push({ x: a.x + ((b.x - a.x) * s) / d, y: a.y + ((b.y - a.y) * s) / d });
    carry = (carry + d) % STEP;
  }
  if (dist(out[out.length - 1], road[road.length - 1]) > 1e-6) out.push(road[road.length - 1]);
  return out;
}
