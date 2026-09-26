// Static map objects: rocks, wrecks, towns and locations.

import Phaser from 'phaser';
import type { LocationDef, TownDef } from '../data/region';
import type { Obstacle } from '../sim/types';
import type { Vec } from '../sim/vec';
import { drawBox, drawPrism, groundEllipse, rotate } from './box';
import { toScreen, toScreenFlat } from './iso';
import { hash2, hashStr } from './noise';
import { PAL, shade } from './palette';
import { fillPoly } from './poly';

// Draw order follows the front edge of a footprint of radius r, so ground rows under it are drawn
// first and hills in front are drawn over it.
export function depthOf(p: Vec, r: number): number {
  return toScreenFlat(p.x + r, p.y + r).y;
}

export function drawObstacle(scene: Phaser.Scene, o: Obstacle): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(depthOf(o.pos, o.r));
  if (o.kind !== 'water' && o.kind !== 'site') groundEllipse(g, { x: o.pos.x + 0.25, y: o.pos.y + 0.25 }, o.r * 1.05, PAL.shadow, 0.22);
  if (o.kind === 'rock') drawRock(g, o);
  if (o.kind === 'wreck') drawWreck(g, o.pos, o.r, hashStr(o.id) * Math.PI * 2);
  if (o.kind === 'building') drawBuilding(g, o);
  if (o.kind === 'water') drawPond(g, o);
  return g;
}

function drawBuilding(g: Phaser.GameObjects.Graphics, o: Obstacle): void {
  const h = hashStr(o.id);
  const size = o.r * 0.78;
  const height = 16 + h * 20;
  const heading = h * Math.PI;
  const roof = PAL.roof[Math.floor(h * 97) % PAL.roof.length];
  drawBox(g, o.pos, heading, { from: -size, to: size, halfWidth: size * 0.8, z: 0, height, side: PAL.wall.side, top: PAL.wall.top });
  drawBox(g, o.pos, heading, { from: -size - 0.08, to: size + 0.08, halfWidth: size * 0.88, z: height, height: 4, side: shade(roof, 0.8), top: roof });
}

function drawPond(g: Phaser.GameObjects.Graphics, o: Obstacle): void {
  groundEllipse(g, o.pos, o.r + 0.25, shade(PAL.scrub[1], 1.05), 0.9);
  groundEllipse(g, o.pos, o.r, PAL.water, 1);
  groundEllipse(g, { x: o.pos.x - 0.25, y: o.pos.y - 0.2 }, o.r * 0.45, PAL.waterLight, 0.6);
}

function drawRock(g: Phaser.GameObjects.Graphics, o: Obstacle): void {
  const seed = hashStr(o.id);
  const n = 7;
  const ground: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed;
    const r = o.r * (0.85 + hash2(i, Math.floor(seed * 1e6)) * 0.2);
    ground.push({ x: o.pos.x + Math.cos(a) * r, y: o.pos.y + Math.sin(a) * r });
  }
  const h = 10 + o.r * 22;
  const tint = 0.9 + seed * 0.2;
  drawPrism(g, ground, 0, h * 0.6, shade(PAL.rock.side, tint), shade(PAL.rock.top, tint));
  const inner = ground.map((p) => ({ x: o.pos.x + (p.x - o.pos.x) * 0.62, y: o.pos.y + (p.y - o.pos.y) * 0.62 }));
  drawPrism(g, inner, h * 0.6, h * 0.4, shade(PAL.rock.side, tint * 1.05), shade(PAL.rock.top, tint * 1.08));
}

// A tall rock mass covering impassable high ground. Two stacked, shrinking prisms give it a peak.
// Burnt truck: scorched ground, rusted bed, crushed cab, a loose wheel.
export function drawWreck(g: Phaser.GameObjects.Graphics, pos: Vec, r: number, heading: number): void {
  const k = r / 0.7;
  groundEllipse(g, pos, r * 1.25, PAL.shadow, 0.28);
  drawBox(g, pos, heading, { from: -0.85 * k, to: 0.25 * k, halfWidth: 0.4 * k, z: 2, height: 8, side: PAL.rust.side, top: PAL.rust.top });
  drawBox(g, pos, heading, { from: -0.7 * k, to: -0.2 * k, halfWidth: 0.3 * k, z: 10, height: 3, side: PAL.rust.dark, top: shade(PAL.rust.top, 0.7) });
  drawBox(g, pos, heading, { from: 0.3 * k, to: 0.75 * k, halfWidth: 0.36 * k, z: 2, height: 7, side: PAL.rust.dark, top: shade(PAL.rust.top, 0.6) });
  drawBox(g, rotate(pos, heading, 0.2 * k, 0.75 * k), heading + 0.9, { from: -0.12, to: 0.12, halfWidth: 0.12, z: 0, height: 4, side: PAL.wheel, top: shade(PAL.wheel, 1.5) });
}

export function drawTown(scene: Phaser.Scene, town: TownDef): Phaser.GameObjects.Graphics[] {
  return [drawWaterTower(scene, { x: town.pos.x - 0.6, y: town.pos.y + 0.4 })];
}

function drawWaterTower(scene: Phaser.Scene, pos: Vec): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(depthOf(pos, 0.5));
  groundEllipse(g, { x: pos.x + 0.4, y: pos.y + 0.4 }, 0.5, PAL.shadow, 0.2);
  const s = toScreen(pos.x, pos.y);
  g.lineStyle(2, PAL.metal, 1);
  for (const dx of [-8, 8]) g.lineBetween(s.x + dx, s.y, s.x + dx * 0.6, s.y - 40);
  drawBox(g, pos, Math.PI / 4, { from: -0.35, to: 0.35, halfWidth: 0.35, z: 40, height: 18, side: PAL.metal, top: PAL.metalLight });
  return g;
}

export function drawLocation(scene: Phaser.Scene, loc: LocationDef): Phaser.GameObjects.Graphics[] {
  return loc.kind === 'oasis' ? drawOasis(scene, loc) : drawConvoy(scene, loc);
}

function drawOasis(scene: Phaser.Scene, loc: LocationDef): Phaser.GameObjects.Graphics[] {
  const out: Phaser.GameObjects.Graphics[] = [];
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + 0.4;
    const p = { x: loc.pos.x + Math.cos(a) * loc.radius * 0.8, y: loc.pos.y + Math.sin(a) * loc.radius * 0.8 };
    out.push(drawPalm(scene, p, i));
  }
  return out;
}

function drawPalm(scene: Phaser.Scene, pos: Vec, i: number): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(depthOf(pos, 0.5));
  const s = toScreen(pos.x, pos.y);
  g.fillStyle(PAL.shadow, 0.2);
  g.fillEllipse(s.x + 14, s.y + 4, 36, 12);
  const lean = (i % 2 === 0 ? 1 : -1) * 6;
  const top = { x: s.x + lean, y: s.y - 44 };
  g.lineStyle(4, PAL.trunk, 1);
  g.lineBetween(s.x, s.y, top.x, top.y);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const tip = { x: top.x + Math.cos(a) * 20, y: top.y + Math.sin(a) * 8 + 6 };
    fillPoly(g, [top, { x: (top.x + tip.x) / 2 - Math.sin(a) * 4, y: (top.y + tip.y) / 2 - 3 }, tip], shade(PAL.palm, 0.85 + k * 0.05));
  }
  return g;
}

function drawConvoy(scene: Phaser.Scene, loc: LocationDef): Phaser.GameObjects.Graphics[] {
  const crates = scene.add.graphics().setDepth(depthOf(loc.pos, 0.3));
  drawBox(crates, loc.pos, 0.3, { from: -0.2, to: 0.2, halfWidth: 0.2, z: 0, height: 9, side: shade(PAL.crate, 0.8), top: PAL.crate });
  return [crates];
}
