import Phaser from 'phaser';
import type { WeaponDef } from '../data/parts';
import type { Vehicle } from '../sim/types';
import { DEG } from '../sim/vec';
import { groundRing } from './box';
import { toScreen } from './iso';
import { PAL } from './palette';
import { fillPoly, strokePoly } from './poly';

export function drawWeaponRange(g: Phaser.GameObjects.Graphics, vehicle: Vehicle, weapon: WeaponDef): void {
  if (weapon.arc >= 360) {
    groundRing(g, vehicle.pos, weapon.range, 2, PAL.select, 0.8);
    return;
  }
  // At most five degrees per segment keeps the projected sector edge smooth.
  const steps = Math.ceil(weapon.arc / 5);
  const half = weapon.arc * DEG / 2;
  const points = [toScreen(vehicle.pos.x, vehicle.pos.y)];
  for (let i = 0; i <= steps; i++) {
    const angle = vehicle.heading - half + 2 * half * i / steps;
    points.push(toScreen(vehicle.pos.x + Math.cos(angle) * weapon.range, vehicle.pos.y + Math.sin(angle) * weapon.range));
  }
  fillPoly(g, points, PAL.select, 0.1);
  strokePoly(g, points, 2, PAL.select, 0.8);
}
