// Throttle zones in front of the truck: where a click brakes, holds speed or accelerates this turn.

import Phaser from "phaser";
import { zoneEdges, type Throttle } from "../sim/steering";
import type { Pose } from "../sim/types";
import { toScreen } from "./iso";
import { PAL } from "./palette";
import { fillPoly } from "./poly";

const ZONE_ALPHA: Record<Throttle, number> = {
  brake: 0.16,
  hold: 0.28,
  accelerate: 0.18,
};
const MIN_HALF_ANGLE = Math.PI / 12; // zones stay visible for trucks that barely turn
const ARC_STEPS = 16;

// turn is the truck's turn limit this turn; the zones fan out over half of it on each side.
// At rest the red sector is one third of reach and green covers the remaining two thirds.
export function drawThrottleZones(
  g: Phaser.GameObjects.Graphics,
  pose: Pose,
  speed: number,
  turn: number,
): void {
  const half = Math.max(MIN_HALF_ANGLE, turn / 2);
  const z = zoneEdges();
  if (speed === 0) {
    band(g, pose, half, 0, z.restBrakeEnd, "brake");
    band(g, pose, half, z.restBrakeEnd, z.reach, "accelerate");
  } else {
    band(g, pose, half, 0, z.brakeEnd, "brake");
    band(g, pose, half, z.brakeEnd, z.holdEnd, "hold");
    band(g, pose, half, z.holdEnd, z.reach, "accelerate");
  }
}

// Annular sector between radii r0 and r1 around the heading, in map space.
function band(
  g: Phaser.GameObjects.Graphics,
  pose: Pose,
  half: number,
  r0: number,
  r1: number,
  t: Throttle,
): void {
  if (r1 - r0 < 0.05) return;
  const pts = [];
  for (let i = 0; i <= ARC_STEPS; i++)
    pts.push(
      arcPoint(pose, pose.heading - half + (2 * half * i) / ARC_STEPS, r1),
    );
  for (let i = ARC_STEPS; i >= 0; i--)
    pts.push(
      arcPoint(pose, pose.heading - half + (2 * half * i) / ARC_STEPS, r0),
    );
  fillPoly(g, pts, PAL.throttle[t], ZONE_ALPHA[t]);
}

function arcPoint(pose: Pose, a: number, r: number): { x: number; y: number } {
  return toScreen(pose.x + Math.cos(a) * r, pose.y + Math.sin(a) * r);
}
