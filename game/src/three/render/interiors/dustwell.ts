// Dustwell's interior (C2): a water pumpjack along the back-left wall with its beam rocking, two tall storage tanks in
// the back-right corner, a squat tank on the left, a lit shed just inside the gate and pipes from the wellhead to the
// tanks.
//
// Offsets are site tiles: x is map x, z is map y. The gate faces east (+x), so the camera, at +x +y, sees the gate face
// on the right as C2 does. "Back" is west and north, away from the camera.

import * as THREE from 'three';
import { PAL } from '../../../render/palette';
import { model, socket } from '../models';
import { rock } from '../site-motion';
import type { SiteBuilder } from '../sites';

// The pumpjack's bearing, along the west wall. Its +X (horsehead and wellhead) points north, so the beam runs along the
// wall as in C2, with the horsehead at the back.
const PUMP = { x: -1.6, z: 0.3, yaw: Math.PI / 2 };
const WELL = 7 / 4; // tiles from the bearing to the wellhead (pumpjack_base WELL_X)
// C2's walking beam rocks +-18 degrees on a 6 s stroke.
const STROKE = { amplitude: (18 * Math.PI) / 180, period: 6 };
const TANKS = [
  { x: 0.45, z: -2.2 },
  { x: 2.0, z: -2.0 },
];
const TANK_OUTLET = (2.6 + 0.45) / 4; // tiles from a tank's center to its outlet valve, on its +z side
const SQUAT = { x: -0.1, z: 1.9, height: 0.42 }; // height: share of the tall tank's
// The reused scrap shack, 1.5x so it reads as C2's shed, its door (+X) turned to face the yard (+z). C2's shed stands
// just behind the gate, but the 12 m east wall hides everything there lower than about 5 m from the camera, so it
// stands two tiles further in, in front of the tanks, where its roof shows over the walls.
const SHED = { x: 0.3, z: -0.3, yaw: -Math.PI / 2, scale: 1.5 };
// The lit doorway fills the shack's door gap (tools/blender/shack.py), in tiles after the shed's scale.
const SHED_DOOR = {
  reach: (2.03 * SHED.scale) / 4 + 0.01, // just out of the door plane, 2.03 m along the shack's +X
  width: (0.9 * SHED.scale) / 4 - 0.04, // inside the 0.9 m gap
  height: (1.8 * SHED.scale) / 4 - 0.05, // under the 1.8 m lintel
};
const SHED_LAMP = { reach: 0.12, size: 0.14, lift: 0.66 }; // tiles: a lantern hung over the door, out from the door plane
const PIPE = { size: 0.08, lift: 0.12, support: 0.6 }; // tiles; supports every `support` tiles

export function buildDustwell(b: SiteBuilder): void {
  addPumpjack(b);
  for (const tank of TANKS) b.addModel('storage_tank', tank.x, tank.z).name = 'dustwell-tank';
  b.addModel('storage_tank', SQUAT.x, SQUAT.z, 0.6, new THREE.Vector3(1, SQUAT.height, 1)).name = 'dustwell-tank';
  addShed(b);
  addPipes(b);
}

function addPumpjack(b: SiteBuilder): void {
  const base = b.addModel('pumpjack_base', PUMP.x, PUMP.z, PUMP.yaw);
  base.name = 'pumpjack';
  const beam = model('pumpjack_beam');
  beam.name = 'pumpjack-beam';
  beam.position.copy(socket('pumpjack_base', 'beam'));
  base.add(beam);
  // The beam's Blender Y, its rocking axis, is the model's local z.
  b.addMover(beam, rock(new THREE.Vector3(0, 0, 1), STROKE.amplitude, STROKE.period));
}

// The shed with its doorway lit, as C2's shed glows at the door.
function addShed(b: SiteBuilder): void {
  b.addModel('shack', SHED.x, SHED.z, SHED.yaw, SHED.scale).name = 'dustwell-shed';
  b.addBox(SHED.x, SHED.z + SHED_DOOR.reach, SHED_DOOR.width, SHED_DOOR.height, 0.02, PAL.lamp.on).name = 'dustwell-shed-door';
  const lamp = SHED.z + SHED_DOOR.reach + SHED_LAMP.reach;
  b.addBox(SHED.x, lamp - SHED_LAMP.reach / 2, 0.03, 0.03, SHED_LAMP.reach, PAL.metal, SHED_LAMP.lift + SHED_LAMP.size);
  b.addBox(SHED.x, lamp, SHED_LAMP.size, SHED_LAMP.size, SHED_LAMP.size, PAL.lamp.on, SHED_LAMP.lift).name = 'dustwell-shed-lamp';
}

// A header pipe on low supports from the wellhead east past both tank outlets, with a stub up to each outlet.
function addPipes(b: SiteBuilder): void {
  const well = { x: PUMP.x, z: PUMP.z - WELL };
  const end = TANKS[TANKS.length - 1].x;
  const length = end - well.x;
  b.addBox(well.x + length / 2, well.z, length, PIPE.size, PIPE.size, PAL.metal, PIPE.lift);
  for (let x = well.x + PIPE.support; x < end; x += PIPE.support) b.addBox(x, well.z, PIPE.size, PIPE.lift, PIPE.size * 2, PAL.rust.dark);
  for (const tank of TANKS) {
    const outlet = tank.z + TANK_OUTLET;
    const run = Math.abs(well.z - outlet);
    b.addBox(tank.x, (well.z + outlet) / 2, PIPE.size, PIPE.size, run, PAL.metal, PIPE.lift);
  }
}
