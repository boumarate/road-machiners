// Extruded shapes in map space, drawn with painter's order and simple lighting.

import Phaser from 'phaser';
import { toScreen } from './iso';
import { PAL, shade } from './palette';
import { fillPoly, strokePoly } from './poly';

type Pt = { x: number; y: number };

// Box in the owner's local frame: x runs forward, y runs right. Heights in pixels.
export type Box = {
  from: number;
  to: number;
  halfWidth: number;
  z: number; // base height above ground
  height: number;
  side: number;
  top: number;
  offsetY?: number; // sideways offset of the box center
};

// Direction toward the light in map space. Faces turned to screen lower left get lit,
// faces turned to screen lower right stay in shade.
const LIGHT = { x: -0.5, y: 0.85 };

export function drawBox(g: Phaser.GameObjects.Graphics, pos: Pt, heading: number, b: Box): void {
  const oy = b.offsetY ?? 0;
  const local: [number, number][] = [
    [b.from, oy - b.halfWidth],
    [b.to, oy - b.halfWidth],
    [b.to, oy + b.halfWidth],
    [b.from, oy + b.halfWidth],
  ];
  const ground = local.map(([lx, ly]) => rotate(pos, heading, lx, ly));
  drawPrism(g, ground, b.z, b.height, b.side, b.top);
}

// Vertical prism over a map-space polygon given in counterclockwise or clockwise order.
export function drawPrism(g: Phaser.GameObjects.Graphics, ground: Pt[], z: number, height: number, side: number, top: number): void {
  const base = ground.map((p) => lift(toScreen(p.x, p.y), z));
  const cap = base.map((p) => lift(p, height));
  const n = ground.length;
  const faces: { quad: Pt[]; depth: number; color: number }[] = [];
  const cx = ground.reduce((a, p) => a + p.x, 0) / n;
  const cy = ground.reduce((a, p) => a + p.y, 0) / n;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const mx = (ground[i].x + ground[j].x) / 2;
    const my = (ground[i].y + ground[j].y) / 2;
    // Outward normal in map space; faces pointing away from the viewer are hidden.
    let nx = ground[j].y - ground[i].y;
    let ny = -(ground[j].x - ground[i].x);
    if (nx * (mx - cx) + ny * (my - cy) < 0) {
      nx = -nx;
      ny = -ny;
    }
    if (nx + ny <= 0) continue;
    const len = Math.hypot(nx, ny) || 1;
    const lit = 0.7 + 0.35 * Math.max(0, (nx * LIGHT.x + ny * LIGHT.y) / len);
    faces.push({ quad: [base[i], base[j], cap[j], cap[i]], depth: base[i].y + base[j].y, color: shade(side, lit) });
  }
  faces.sort((a, b) => a.depth - b.depth);
  for (const f of faces) {
    fillPoly(g, f.quad, f.color);
    strokePoly(g, f.quad, 1, PAL.outline, 0.35);
  }
  fillPoly(g, cap, top);
  strokePoly(g, cap, 1, PAL.outline, 0.45);
}

export function rotate(pos: Pt, heading: number, lx: number, ly: number): Pt {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return { x: pos.x + lx * c - ly * s, y: pos.y + lx * s + ly * c };
}

function lift(p: Pt, h: number): Pt {
  return { x: p.x, y: p.y - h };
}

// Ground ellipse of radius r tiles, projected.
export function groundEllipse(g: Phaser.GameObjects.Graphics, pos: Pt, r: number, color: number, alpha: number): void {
  const pts: Pt[] = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    pts.push(toScreen(pos.x + Math.cos(a) * r, pos.y + Math.sin(a) * r));
  }
  fillPoly(g, pts, color, alpha);
}

export function groundRing(g: Phaser.GameObjects.Graphics, pos: Pt, r: number, width: number, color: number, alpha: number): void {
  const pts: Pt[] = [];
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    pts.push(toScreen(pos.x + Math.cos(a) * r, pos.y + Math.sin(a) * r));
  }
  strokePoly(g, pts, width, color, alpha);
}
