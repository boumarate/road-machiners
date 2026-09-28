// Time of day and the sun. Pure functions of the turn number.

import { TIME } from "../data/time";
import { weatherAt } from "./weather";
import type { World } from "./types";
import { heightAt } from "./terrain";
import { clamp, dist, type Vec } from "./vec";

// dir is the unit map direction toward the sun. elevation is its height above the horizon in radians.
export type Sun = { dir: Vec; elevation: number };

export function clockOf(turn: number): { day: number; hour: number } {
  const hours = TIME.startHour + ((turn - 1) * 24) / TIME.turnsPerDay;
  return { day: Math.floor(hours / 24) + 1, hour: hours % 24 };
}

// The sun rises in the east (+x), crosses the north (-y) at noon and sets in the west. Null at night.
// North is the far side from the camera, so terrain shadows fall toward the viewer.
export function sunAt(turn: number): Sun | null {
  const { hour } = clockOf(turn);
  if (hour <= TIME.sunrise || hour >= TIME.sunset) return null;
  const t = (hour - TIME.sunrise) / (TIME.sunset - TIME.sunrise);
  const elevation =
    Math.sin(Math.PI * t) * TIME.noonElevation * (Math.PI / 180);
  return {
    dir: { x: Math.cos(Math.PI * t), y: -Math.sin(Math.PI * t) },
    elevation,
  };
}

// Whether pos sits in shade: steps toward the sun and checks the terrain and blocking obstacles
// against the ray. Obstacles farther than the shade reach can never block, so they are filtered
// once up front rather than on every sample.
export function inShade(world: World, pos: Vec, sun: Sun): boolean {
  const base = heightAt(world.terrain, pos.x, pos.y);
  const rise = Math.tan(sun.elevation);
  const near = world.obstacles.filter((o) => {
    const h = TIME.obstacleShade[o.kind];
    return h !== undefined && dist(pos, o.pos) <= TIME.shadeReach + o.r;
  });
  for (let i = 1; i <= TIME.shadeSamples; i++) {
    const d = (TIME.shadeReach * i) / TIME.shadeSamples;
    const p = { x: pos.x + sun.dir.x * d, y: pos.y + sun.dir.y * d };
    const rayHeight = base + rise * d;
    if (heightAt(world.terrain, p.x, p.y) > rayHeight) return true;
    for (const o of near) {
      if (dist(p, o.pos) > o.r) continue;
      if (
        heightAt(world.terrain, o.pos.x, o.pos.y) + TIME.obstacleShade[o.kind] >
        rayHeight
      )
        return true;
    }
  }
  return false;
}

// 1 in shade and at night, above 1 in full sun. Weather multiplies the sun-driven share above 1:
// overcast cancels it, a heat wave amplifies it.
export function heatAt(world: World, pos: Vec): number {
  const sun = sunAt(world.turn);
  if (!sun || inShade(world, pos, sun)) return 1;
  return sunHeatAt(world, pos, sun);
}

// Heat at pos if it stands in the sun. For callers that already know pos is not in shade.
export function sunHeatAt(world: World, pos: Vec, sun: Sun): number {
  const t = clamp(sun.elevation / (TIME.noonElevation * (Math.PI / 180)), 0, 1);
  const excess = (TIME.sunHeat - 1) * t;
  return 1 + excess * weatherAt(world, pos).heat;
}
