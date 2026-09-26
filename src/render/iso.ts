// Map tiles <-> screen pixels for a 2:1 isometric projection, lifted by ground height.
//
// The ground height field is render-only module state set once by the scene after the terrain is built.
// Every draw helper projects through toScreen, so this keeps trucks, props, shadows and markers on
// the ground without threading the height field through each call.

export const TILE_W = 64;
export const TILE_H = 32;

type Lift = (x: number, y: number) => number; // screen pixels the ground rises at a map point

let lift: Lift = () => 0;

export function setGroundLift(fn: Lift): void {
  lift = fn;
}

export function groundLift(x: number, y: number): number {
  return lift(x, y);
}

// Projection of a map point on the ground.
export function toScreen(x: number, y: number): { x: number; y: number } {
  return { x: (x - y) * (TILE_W / 2), y: (x + y) * (TILE_H / 2) - lift(x, y) };
}

// Projection ignoring ground height. Used for depth sorting, which must follow map rows, not hills.
export function toScreenFlat(x: number, y: number): { x: number; y: number } {
  return { x: (x - y) * (TILE_W / 2), y: (x + y) * (TILE_H / 2) };
}

function flatToWorld(sx: number, sy: number): { x: number; y: number } {
  const a = sx / (TILE_W / 2);
  const b = sy / (TILE_H / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

// Screen point to the map point on the ground under it. Fixed-point iteration on the lift;
// it converges for slopes gentler than the view angle, which the relief data keeps.
const PICK_ITERATIONS = 8;

export function toWorld(sx: number, sy: number): { x: number; y: number } {
  let p = flatToWorld(sx, sy);
  for (let i = 0; i < PICK_ITERATIONS; i++) p = flatToWorld(sx, sy + lift(p.x, p.y));
  return p;
}
