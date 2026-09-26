// Ground painted from the terrain grid: tile type colors, hillshade from tile slopes, roads and scatter.
// The painting is draped over one mesh whose vertices are the grid corners.

import Phaser from 'phaser';
import { REGION } from '../data/region';
import { TERRAIN, TERRAIN_TYPES } from '../data/terrain';
import { tileAt, tileSlope, type Terrain } from '../sim/terrain';
import { polylineDist, type Vec } from '../sim/vec';
import { drapeCanvas, makeMapCanvas, type IsoCanvas } from './isoCanvas';
import { hash2, valueNoise } from './noise';
import { PAL, mix, shade } from './palette';

export const TERRAIN_MARGIN = 10; // tiles of dim ground drawn past the map edge
const MARGIN = TERRAIN_MARGIN;
const RES = 6; // canvas pixels per tile
const MESH_STEP = 1; // one mesh quad per tile, so vertices sit exactly on grid corners
const TYPE_JITTER = 0.6; // tiles; jittered sampling frays the blend between tile types
const GROUND_DEPTH = -1e6;

// Call after setGroundLift, so the mesh follows the relief.
export function drawTerrain(scene: Phaser.Scene, t: Terrain): void {
  const c = makeMapCanvas(scene, 'terrain', -MARGIN, t.size + 2 * MARGIN, RES);
  paintGround(c, t);
  for (const l of REGION.locations) disc(c, l.pos, l.radius + 0.5, css(l.kind === 'oasis' ? shade(PAL.scrub[0], 1.1) : shade(PAL.rust.dark, 1.6), 0.45));
  for (const road of REGION.roads) paintRoad(c, road);
  paintScatter(c, t.size);
  c.texture.refresh();
  drapeCanvas(scene, c, MESH_STEP, GROUND_DEPTH);
}

// Hillshade: brighten slopes turned toward the light, darken slopes turned away.
function hillshade(t: Terrain, tile: number): number {
  const s = tileSlope(t, tile);
  return 1 + (s.x * TERRAIN.light.x + s.y * TERRAIN.light.y) * TERRAIN.slopeShade;
}

// Type colors blend between tile centers, with a little jitter so borders look worn, not ruled.
function typeColor(t: Terrain, x: number, y: number): number {
  const jx = x + (hash2(Math.floor(x * RES), Math.floor(y * RES) + 7) - 0.5) * TYPE_JITTER - 0.5;
  const jy = y + (hash2(Math.floor(x * RES) + 3, Math.floor(y * RES)) - 0.5) * TYPE_JITTER - 0.5;
  const i = Math.floor(jx);
  const j = Math.floor(jy);
  const at = (a: number, b: number) => TERRAIN_TYPES[t.types[tileAt(t, { x: a + 0.5, y: b + 0.5 })]].color;
  const fx = jx - i;
  const fy = jy - j;
  return mix(mix(at(i, j), at(i + 1, j), fx), mix(at(i, j + 1), at(i + 1, j + 1), fx), fy);
}

function groundColor(t: Terrain, x: number, y: number): number {
  const n = valueNoise(x / 7, y / 7) * 0.7 + valueNoise(x / 2.5, y / 2.5) * 0.3;
  let color = mix(typeColor(t, x, y), PAL.sand[3], n * 0.2);
  color = shade(color, (0.97 + hash2(Math.floor(x * 3), Math.floor(y * 3)) * 0.05) * hillshade(t, tileAt(t, { x, y })));
  const out = Math.max(-x, -y, x - t.size, y - t.size, 0);
  if (out > 0) color = mix(color, PAL.sandFar, Math.min(1, 0.35 + out / MARGIN));
  return color;
}

function paintGround(c: IsoCanvas, t: Terrain): void {
  const img = c.ctx.createImageData(c.size, c.size);
  for (let py = 0; py < c.size; py++) {
    for (let px = 0; px < c.size; px++) {
      const color = groundColor(t, c.from + (px + 0.5) / c.res, c.from + (py + 0.5) / c.res);
      const i = (py * c.size + px) * 4;
      img.data[i] = (color >> 16) & 0xff;
      img.data[i + 1] = (color >> 8) & 0xff;
      img.data[i + 2] = color & 0xff;
      img.data[i + 3] = 255;
    }
  }
  c.ctx.putImageData(img, 0, 0);
}

function css(color: number, alpha: number): string {
  return `rgba(${(color >> 16) & 0xff},${(color >> 8) & 0xff},${color & 0xff},${alpha})`;
}

function paintRoad(c: IsoCanvas, road: Vec[]): void {
  const w = REGION.roadWidth;
  stroke(c, road, w + 0.3, css(shade(PAL.road, 1.06), 0.5), 0);
  stroke(c, road, w, css(PAL.road, 1), 0);
  stroke(c, road, 0.24, css(PAL.roadRut, 0.8), -0.35);
  stroke(c, road, 0.24, css(PAL.roadRut, 0.8), 0.35);
}

// A polyline stroke in map units, shifted sideways by offset tiles along each segment's normal.
function stroke(c: IsoCanvas, line: Vec[], width: number, style: string, offset: number): void {
  const ctx = c.ctx;
  ctx.strokeStyle = style;
  ctx.lineWidth = width * c.res;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i];
    const b = line[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = (-(b.y - a.y) / len) * offset;
    const ny = ((b.x - a.x) / len) * offset;
    if (i === 0) ctx.moveTo(c.toPx(a.x + nx), c.toPx(a.y + ny));
    ctx.lineTo(c.toPx(b.x + nx), c.toPx(b.y + ny));
  }
  ctx.stroke();
}

// Pebbles and dry scrub. Decoration only, no collision.
function paintScatter(c: IsoCanvas, size: number): void {
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      const h = hash2(x * 7 + 3, y * 13 + 5);
      const p = { x: x + hash2(x, y * 3), y: y + hash2(x * 5, y) };
      const onRoad = REGION.roads.some((r) => polylineDist(p, r) < REGION.roadWidth / 2 + 0.3);
      if (onRoad) continue;
      if (h < 0.18) blob(c, p, 0.05 + h * 0.3, css(PAL.pebble, 0.7));
      else if (h > 0.93) scrub(c, p, h);
    }
  }
}

function scrub(c: IsoCanvas, p: Vec, h: number): void {
  const color = PAL.scrub[Math.floor(h * 1000) % PAL.scrub.length];
  blob(c, { x: p.x + 0.12, y: p.y + 0.12 }, 0.32, css(PAL.shadow, 0.18));
  for (let i = 0; i < 4; i++) {
    const o = { x: p.x + (hash2(p.x * 10 + i, p.y * 10) - 0.5) * 0.35, y: p.y + (hash2(p.x * 10, p.y * 10 + i) - 0.5) * 0.35 };
    blob(c, o, 0.14, css(shade(color, 0.85 + i * 0.07), 1));
  }
}

function disc(c: IsoCanvas, p: Vec, r: number, style: string): void {
  blob(c, p, r, style);
}

function blob(c: IsoCanvas, p: Vec, r: number, style: string): void {
  c.ctx.fillStyle = style;
  c.ctx.beginPath();
  c.ctx.arc(c.toPx(p.x), c.toPx(p.y), r * c.res, 0, Math.PI * 2);
  c.ctx.fill();
}
