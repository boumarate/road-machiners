// Hull deck plating: a metal plate laid on each hull deck the bake stamped into the ground, with panel seams, a torn
// lip at the high end and skirts that hang from the plate edge to the floor over the deck's steep edge tiles.
// Decoration only: the deck is ground, so physics, nav and sight read the baked heights and never this mesh.
// Deck geometry comes from src/sim/territory.ts, the same owner the bake reads.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { hash2 } from '../../render/noise';
import { deckAlongAt, deckPlane, hullDecks, type HullDeck } from '../../sim/territory';
import { heightAt, type Terrain } from '../../sim/terrain';
import { lerp, type Vec } from '../../sim/vec';
import { RenderScope, type SightLimit } from './scope';

const S = PHYSICS.metersPerTile;
export const PLATE_LIFT = 0.12; // meters the plate floats over the ground, so the ground never shows through it
const GRID = 0.25; // tiles between plate samples, finer than a tile so the plate follows ground that rises over the deck
const SEAM_STEP = 2; // tiles between panel seams along the deck
const SEAM_LINES = 3; // panel seams along the deck, spread evenly across it
const SEAM_WIDTH = 0.18; // meters
const SEAM_LIFT = 0.04; // meters a seam stands over the plate
const SKIRT_REACH = 1.5; // tiles out from the plate edge to the floor the skirt hangs to, past the stamped edge tile
const SKIRT_SINK = 0.3; // meters a skirt reaches below the floor, so its foot never floats on a slope
const TOOTH = 0.6; // tiles across one tooth of the torn lip
const TOOTH_REACH = 1; // most tiles a tooth sticks out past the high end
const TOOTH_BEND = 1.4; // most meters a tooth bends up past the plate, or down by half that

type Mesh = { positions: number[]; index: number[] };

// The plating gets its own scope under root: it greys out of sight like props, but takes no prop outline, since
// outlines mark PROP_BIT and that stencil bit belongs to props.
export function addHullDecks(t: Terrain, root: THREE.Object3D, limit: SightLimit): RenderScope {
  const scope = new RenderScope(root, t.size, limit, true, false);
  for (const deck of hullDecks()) {
    const { length, width } = deck.section;
    scope.add(buildHullDeck(t, deck), { x: lerp(deck.low.x, deck.high.x, 0.5), y: lerp(deck.low.y, deck.high.y, 0.5) }, Math.hypot(length, width) / 2 + SKIRT_REACH + TOOTH_REACH);
  }
  return scope;
}

export function buildHullDeck(t: Terrain, deck: HullDeck): THREE.Group {
  const plate = new DeckPlate(t, deck);
  const group = new THREE.Group();
  group.name = `hull-deck-${deck.section.id}`;
  group.add(
    part('plate', plate.surface(), PAL.metalLight, true),
    part('seams', plate.seams(), PAL.metal, false),
    part('lip', plate.lip(), PAL.rust.top, true),
    part('skirts', plate.skirts(), PAL.metal, true),
  );
  return group;
}

function part(name: string, mesh: Mesh, color: number, castShadow: boolean): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
  geo.setIndex(mesh.index);
  geo.computeVertexNormals();
  const out = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, flatShading: true, side: THREE.DoubleSide }));
  out.name = name;
  out.castShadow = castShadow;
  out.receiveShadow = true;
  return out;
}

// One deck in its own frame: s is the share of the length from the low end, c the tiles to the left of the middle line.
class DeckPlate {
  private readonly dir: Vec;
  private readonly left: Vec;
  private readonly lowGround: number;

  constructor(private readonly t: Terrain, private readonly deck: HullDeck) {
    const { length } = deck.section;
    this.dir = { x: (deck.high.x - deck.low.x) / length, y: (deck.high.y - deck.low.y) / length };
    this.left = { x: this.dir.y, y: -this.dir.x };
    this.lowGround = bakedLowGround(t, deck);
  }

  private at(s: number, c: number): Vec {
    const a = s * this.deck.section.length;
    return { x: this.deck.low.x + this.dir.x * a + this.left.x * c, y: this.deck.low.y + this.dir.y * a + this.left.y * c };
  }

  // Meters: the deck plane, or the ground where the ground stands higher, as the bake stamped it. Over the steep edge
  // tiles the plane wins, so the plate stays flat to its edge and the skirt hides the drop.
  private height(s: number, c: number): number {
    const p = this.at(s, c);
    return Math.max(heightAt(this.t, p.x, p.y), deckPlane(this.deck, this.lowGround, s)) * S + PLATE_LIFT;
  }

  private vertex(out: Mesh, p: Vec, h: number): number {
    out.positions.push(p.x * S, h, p.y * S);
    return out.positions.length / 3 - 1;
  }

  surface(): Mesh {
    const out: Mesh = { positions: [], index: [] };
    const { length, width } = this.deck.section;
    const ns = Math.ceil(length / GRID);
    const nc = Math.ceil(width / GRID);
    for (let i = 0; i <= ns; i++) {
      for (let j = 0; j <= nc; j++) {
        const [s, c] = [i / ns, -width / 2 + (width * j) / nc];
        this.vertex(out, this.at(s, c), this.height(s, c));
      }
    }
    const row = nc + 1;
    for (let i = 0; i < ns; i++) for (let j = 0; j < nc; j++) quad(out, i * row + j, (i + 1) * row + j, (i + 1) * row + j + 1, i * row + j + 1);
    return out;
  }

  // Seams across the deck every SEAM_STEP tiles, and SEAM_LINES along it, as thin strips over the plate.
  seams(): Mesh {
    const out: Mesh = { positions: [], index: [] };
    const { length, width } = this.deck.section;
    for (let a = SEAM_STEP; a < length; a += SEAM_STEP) this.strip(out, (k) => [a / length, -width / 2 + width * k], width);
    for (let k = 1; k <= SEAM_LINES; k++) this.strip(out, (u) => [u, -width / 2 + (width * k) / (SEAM_LINES + 1)], length);
    return out;
  }

  // A strip along a line of the deck given as (s, c) for u from 0 to 1, span tiles long.
  private strip(out: Mesh, line: (u: number) => [number, number], span: number): void {
    const n = Math.max(1, Math.ceil(span / GRID));
    const half = SEAM_WIDTH / 2 / S;
    let prev: [number, number] | null = null;
    for (let i = 0; i <= n; i++) {
      const [s, c] = line(i / n);
      const [s2, c2] = line(Math.min(1, (i + 0.5) / n));
      const [s1, c1] = line(Math.max(0, (i - 0.5) / n));
      // Perpendicular to the strip, in the deck frame: (ds, dc) turned a quarter.
      const ds = (s2 - s1) * this.deck.section.length;
      const dc = c2 - c1;
      const norm = Math.hypot(ds, dc);
      const [ps, pc] = [(-dc / norm) * half, (ds / norm) * half];
      const h = this.height(s, c) + SEAM_LIFT;
      const sa = s + ps / this.deck.section.length;
      const sb = s - ps / this.deck.section.length;
      const a = this.vertex(out, this.at(sa, c + pc), h);
      const b = this.vertex(out, this.at(sb, c - pc), h);
      if (prev) quad(out, prev[0], a, b, prev[1]);
      prev = [a, b];
    }
  }

  // Jagged teeth of torn plating past the high end, bent up or down, the same on every load.
  lip(): Mesh {
    const out: Mesh = { positions: [], index: [] };
    const { length, width } = this.deck.section;
    const n = Math.max(1, Math.round(width / TOOTH));
    const { x, y } = this.deck.high;
    for (let j = 0; j < n; j++) {
      const [c0, c1] = [-width / 2 + (width * j) / n, -width / 2 + (width * (j + 1)) / n];
      const reach = hash2(x * 31 + j, y * 17) * TOOTH_REACH;
      const bend = (hash2(x * 7, y * 13 + j) * 1.5 - 0.5) * TOOTH_BEND;
      const tip = this.at(1 + reach / length, lerp(c0, c1, hash2(x + j * 5, y * 3)));
      const a = this.vertex(out, this.at(1, c0), this.height(1, c0));
      const b = this.vertex(out, this.at(1, c1), this.height(1, c1));
      const apex = this.vertex(out, tip, this.height(1, (c0 + c1) / 2) + bend);
      out.index.push(a, b, apex);
    }
    return out;
  }

  // Walls from the plate edge down to the floor beyond the edge tile, along both sides and across the high end.
  skirts(): Mesh {
    const out: Mesh = { positions: [], index: [] };
    const { length, width } = this.deck.section;
    const ns = Math.ceil(length / GRID);
    const nc = Math.ceil(width / GRID);
    for (const side of [-1, 1]) {
      this.skirt(out, Array.from({ length: ns + 1 }, (_, i) => [i / ns, (side * width) / 2]), this.left, side);
    }
    this.skirt(out, Array.from({ length: nc + 1 }, (_, j) => [1, -width / 2 + (width * j) / nc]), this.dir, 1);
    return out;
  }

  private skirt(out: Mesh, edge: [number, number][], outward: Vec, side: number): void {
    let prev: [number, number] | null = null;
    for (const [s, c] of edge) {
      const p = this.at(s, c);
      const top = this.height(s, c);
      const foot = { x: p.x + outward.x * side * SKIRT_REACH, y: p.y + outward.y * side * SKIRT_REACH };
      const floor = Math.min(heightAt(this.t, foot.x, foot.y), heightAt(this.t, p.x, p.y)) * S - SKIRT_SINK;
      const a = this.vertex(out, p, top);
      const b = this.vertex(out, p, Math.min(top, floor));
      if (prev) quad(out, prev[0], a, b, prev[1]);
      prev = [a, b];
    }
  }
}

// The ground height at the deck's low end that the bake planed the deck over. Every raised corner stands at the plane
// or above it, so the lowest corner height less the deck's climb there is the plane's base.
function bakedLowGround(t: Terrain, deck: HullDeck): number {
  const xs = deck.corners.map((c) => c.x);
  const ys = deck.corners.map((c) => c.y);
  let low = Infinity;
  for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(t.size, Math.ceil(Math.max(...ys))); y++) {
    for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(t.size, Math.ceil(Math.max(...xs))); x++) {
      const along = deckAlongAt(deck, { x, y });
      if (along !== null) low = Math.min(low, t.heights[y * (t.size + 1) + x] - deckPlane(deck, 0, along));
    }
  }
  if (low === Infinity) throw new Error(`Hull deck ${deck.section.id} covers no terrain corner`);
  return low;
}

function quad(out: Mesh, a: number, b: number, c: number, d: number): void {
  out.index.push(a, b, c, a, c, d);
}
