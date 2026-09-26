// Vehicles built from extruded boxes. Look depends on chassis, faction and installed parts.

import Phaser from 'phaser';
import { chassisDef, type ChassisDef } from '../data/chassis';
import { partDef } from '../data/parts';
import { mountedParts } from '../sim/grid';
import type { Pose, Vehicle } from '../sim/types';
import { drawBox, groundEllipse, groundRing, rotate, type Box } from './box';
import { toScreen } from './iso';
import { FACTION_COLORS, PAL, shade } from './palette';

type Shape = {
  body: { from: number; to: number; hw: number; h: number };
  cab: { from: number; to: number; hw: number; h: number };
  wheelX: number[];
  wheelY: number;
  deckZ: number;
  turretX: number; // local x of the turret mount
  cargoFrom: number;
  cargoTo: number;
};

const SHAPES: Record<ChassisDef['look'], Shape> = {
  pickup: {
    body: { from: -0.75, to: 0.2, hw: 0.36, h: 7 },
    cab: { from: 0.18, to: 0.75, hw: 0.35, h: 15 },
    wheelX: [-0.5, 0.5], wheelY: 0.38, deckZ: 4, turretX: 0.4, cargoFrom: -0.7, cargoTo: 0.05,
  },
  hauler: {
    body: { from: -1.0, to: 0.3, hw: 0.45, h: 12 },
    cab: { from: 0.32, to: 0.95, hw: 0.42, h: 20 },
    wheelX: [-0.75, -0.35, 0.65], wheelY: 0.47, deckZ: 5, turretX: 0.6, cargoFrom: -0.95, cargoTo: 0.2,
  },
  buggy: {
    body: { from: -0.5, to: 0.55, hw: 0.3, h: 4 },
    cab: { from: -0.25, to: 0.15, hw: 0.26, h: 9 },
    wheelX: [-0.4, 0.42], wheelY: 0.36, deckZ: 4, turretX: -0.05, cargoFrom: -0.5, cargoTo: -0.3,
  },
  wagon: {
    body: { from: -0.85, to: 0.55, hw: 0.46, h: 16 },
    cab: { from: 0.55, to: 0.85, hw: 0.4, h: 8 },
    wheelX: [-0.6, 0.0, 0.5], wheelY: 0.46, deckZ: 5, turretX: 0.1, cargoFrom: -0.8, cargoTo: -0.3,
  },
};

type Piece = { box: Box; depth: number };

// aimAngle points turrets; it defaults to the vehicle heading.
// A ground ring drawn under the vehicle, for selection and target marks.
export type Ring = { r: number; width: number; color: number; alpha: number };

export function drawVehicle(g: Phaser.GameObjects.Graphics, v: Vehicle, pose: Pose, aimAngle: number | null, rings: Ring[]): void {
  g.clear();
  const ch = chassisDef(v.chassisId);
  const shape = SHAPES[ch.look];
  const col = FACTION_COLORS[v.faction];
  const pos = { x: pose.x, y: pose.y };
  const h = pose.heading;

  groundEllipse(g, { x: pos.x + 0.18, y: pos.y + 0.18 }, ch.radius * 1.05, PAL.shadow, 0.3);
  for (const ring of rings) groundRing(g, pos, ring.r, ring.width, ring.color, ring.alpha);

  const pieces: Piece[] = [];
  const add = (box: Box) => {
    const cx = (box.from + box.to) / 2;
    const c = rotate(pos, h, cx, box.offsetY ?? 0);
    pieces.push({ box, depth: c.x + c.y + box.z * 0.001 });
  };

  for (const wx of shape.wheelX)
    for (const side of [-1, 1])
      add({ from: wx - 0.13, to: wx + 0.13, halfWidth: 0.07, offsetY: side * shape.wheelY, z: 0, height: 7, side: PAL.wheel, top: shade(PAL.wheel, 1.4) });

  const b = shape.body;
  const c = shape.cab;
  add({ from: b.from, to: b.to, halfWidth: b.hw, z: shape.deckZ, height: b.h, side: col.side, top: col.top });
  add({ from: c.from, to: c.to, halfWidth: c.hw, z: shape.deckZ, height: c.h, side: col.cabSide, top: col.cab });

  addArmor(v, shape, add);
  addCargo(v, shape, add);

  pieces.sort((p, q) => p.depth - q.depth);
  for (const p of pieces) drawBox(g, pos, h, p.box);

  drawWeapons(g, v, shape, pos, h, aimAngle ?? h);
}

function addArmor(v: Vehicle, shape: Shape, add: (b: Box) => void): void {
  for (const p of mountedParts(v)) {
    const def = partDef(p.defId);
    if (def.kind !== 'armor') continue;
    const b = shape.body;
    const tone = p.hp > 0 ? 1 : 0.6;
    if (def.look === 'plates') {
      for (const side of [-1, 1])
        add({ from: b.from + 0.05, to: shape.cab.to - 0.05, halfWidth: 0.03, offsetY: side * (b.hw + 0.03), z: shape.deckZ + 1, height: b.h - 1, side: shade(PAL.metal, tone), top: shade(PAL.metalLight, tone) });
    } else {
      add({ from: shape.cab.to, to: shape.cab.to + 0.08, halfWidth: shape.cab.hw + 0.04, z: 1, height: shape.deckZ + 7, side: shade(PAL.metal, tone * 0.8), top: shade(PAL.metalLight, tone) });
    }
  }
}

function addCargo(v: Vehicle, shape: Shape, add: (b: Box) => void): void {
  for (const p of mountedParts(v)) {
    const def = partDef(p.defId);
    if (def.kind !== 'cargo') continue;
    const z = shape.deckZ + shape.body.h;
    if (def.look === 'box') {
      add({ from: shape.cargoFrom, to: shape.cargoTo, halfWidth: shape.body.hw * 0.9, z, height: 10, side: shade(PAL.crate, 0.75), top: PAL.crate });
    } else {
      const mid = (shape.cargoFrom + shape.cargoTo) / 2;
      add({ from: shape.cargoFrom + 0.05, to: mid - 0.03, halfWidth: 0.16, offsetY: -0.1, z, height: 6, side: shade(PAL.crate, 0.75), top: PAL.crate });
      add({ from: mid + 0.03, to: shape.cargoTo - 0.05, halfWidth: 0.14, offsetY: 0.12, z, height: 5, side: shade(PAL.crate, 0.7), top: shade(PAL.crate, 1.1) });
    }
  }
}

function drawWeapons(g: Phaser.GameObjects.Graphics, v: Vehicle, shape: Shape, pos: { x: number; y: number }, h: number, aim: number): void {
  let mount = 0;
  for (const p of mountedParts(v)) {
    const def = partDef(p.defId);
    if (def.kind !== 'weapon') continue;
    const tone = p.hp > 0 ? 1 : 0.5;
    const lx = shape.turretX - mount * 0.55;
    mount++;
    if (def.look === 'mg') {
      const z = shape.deckZ + shape.cab.h;
      drawBox(g, rotate(pos, h, lx, 0), aim, { from: -0.12, to: 0.12, halfWidth: 0.12, z, height: 6, side: shade(PAL.metal, tone), top: shade(PAL.metalLight, tone) });
      barrel(g, rotate(pos, h, lx, 0), aim, z + 4, 0.45, 2, tone);
    } else {
      const z = shape.deckZ + shape.body.h;
      const base = rotate(pos, h, lx - 0.1, 0);
      drawBox(g, base, h, { from: -0.2, to: 0.2, halfWidth: 0.16, z, height: 6, side: shade(PAL.metal, tone * 0.85), top: shade(PAL.metalLight, tone * 0.9) });
      barrel(g, base, h, z + 3, 0.95, 4, tone);
    }
  }
}

function barrel(g: Phaser.GameObjects.Graphics, base: { x: number; y: number }, angle: number, z: number, len: number, width: number, tone: number): void {
  const tip = rotate(base, angle, len, 0);
  const a = toScreen(base.x, base.y);
  const b = toScreen(tip.x, tip.y);
  g.lineStyle(width + 2, PAL.outline, 0.6);
  g.lineBetween(a.x, a.y - z, b.x, b.y - z);
  g.lineStyle(width, shade(PAL.metal, tone * 0.8), 1);
  g.lineBetween(a.x, a.y - z, b.x, b.y - z);
}

// Screen point of a vehicle's gun, for muzzle flashes.
export function muzzlePoint(pose: Pose): { x: number; y: number } {
  const s = toScreen(pose.x, pose.y);
  return { x: s.x, y: s.y - 22 };
}
