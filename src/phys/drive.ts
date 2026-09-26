// Physics driving. The map's terrain and obstacles become Rapier colliders; the player truck is a
// ray-cast vehicle. Time only moves inside simulateTurn. A turn restores the world from a snapshot
// and runs it forward, so the same state and order always give the same result: the preview is
// the turn itself.

import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS } from '../data/physics';
import { heightAt } from '../sim/terrain';
import type { World } from '../sim/types';
import { angleDiff, clamp, DEG, type Vec } from '../sim/vec';

const S = PHYSICS.metersPerTile;
const T = PHYSICS.truck;
const D = PHYSICS.driver;
const DT = 1 / PHYSICS.stepsPerSecond;
const STEPS = Math.round(PHYSICS.turnSeconds * PHYSICS.stepsPerSecond);
const SETTLE_STEPS = PHYSICS.stepsPerSecond; // one second at rest so the truck sits on its springs

export type V3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };
export type WheelFrame = { steer: number; spin: number; suspension: number };
export type Frame = { pos: V3; rot: Quat; wheels: WheelFrame[] };

// Everything a turn needs to start: the physics world and the driver's memory.
// reverse is 0 when driving forward, or the side the nose swings to while backing up: 1 or -1.
export type Drive = { world: RAPIER.World; body: number; steer: number; reverse: number };

export async function initPhysics(): Promise<void> {
  await RAPIER.init();
}

// Map point to physics point. Map x is physics x, map y is physics z, height is physics y.
export function toPhys(p: Vec, height: number): V3 {
  return { x: p.x * S, y: height * S, z: p.y * S };
}

export function buildDrive(w: World, start: Vec, heading: number): Drive {
  const world = new RAPIER.World({ x: 0, y: -PHYSICS.gravity, z: 0 });
  addTerrain(world, w);
  addObstacles(world, w);
  const ground = heightAt(w.terrain, start.x, start.y) * S;
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(start.x * S, ground + T.wheelRadius + T.suspensionRest + T.halfSize.y, start.y * S)
    .setRotation(headingQuat(heading))
    .setCanSleep(false);
  const body = world.createRigidBody(bodyDesc);
  world.createCollider(RAPIER.ColliderDesc.cuboid(T.halfSize.x, T.halfSize.y, T.halfSize.z).setMass(T.mass), body);
  const drive: Drive = { world, body: body.handle, steer: 0, reverse: 0 };
  const settled = run(drive, null, SETTLE_STEPS);
  world.free();
  return settled.next;
}

export function freeDrive(d: Drive): void {
  d.world.free();
}

// Runs one turn toward dest from a copy of the world. The input drive stays untouched.
export function simulateTurn(d: Drive, dest: Vec | null): { next: Drive; frames: Frame[] } {
  return run(d, dest, STEPS);
}

function run(d: Drive, dest: Vec | null, steps: number): { next: Drive; frames: Frame[] } {
  const world = RAPIER.World.restoreSnapshot(d.world.takeSnapshot());
  world.timestep = DT;
  const body = world.getRigidBody(d.body);
  const car = makeCar(world, body);
  const state = { steer: d.steer, reverse: d.reverse };
  const frames: Frame[] = [];
  for (let i = 0; i < steps; i++) {
    drive(car, body, state, dest);
    car.updateVehicle(DT);
    world.step();
    frames.push(frameOf(car, body));
  }
  world.removeVehicleController(car);
  return { next: { world, body: d.body, steer: state.steer, reverse: state.reverse }, frames };
}

// Wheels 0 and 1 are front and steer. Wheels 2 and 3 are rear and driven.
function makeCar(world: RAPIER.World, body: RAPIER.RigidBody): RAPIER.DynamicRayCastVehicleController {
  const car = world.createVehicleController(body);
  for (const [x, z] of [[T.wheelX, -T.wheelZ], [T.wheelX, T.wheelZ], [-T.wheelX, -T.wheelZ], [-T.wheelX, T.wheelZ]]) {
    const i = car.numWheels();
    car.addWheel({ x, y: T.wheelY, z }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, T.suspensionRest, T.wheelRadius);
    car.setWheelMaxSuspensionTravel(i, T.suspensionTravel);
    car.setWheelSuspensionStiffness(i, T.suspensionStiffness);
    car.setWheelSuspensionCompression(i, T.suspensionCompression);
    car.setWheelSuspensionRelaxation(i, T.suspensionRelaxation);
    car.setWheelMaxSuspensionForce(i, T.maxSuspensionForce);
    car.setWheelFrictionSlip(i, T.frictionSlip);
    car.setWheelSideFrictionStiffness(i, T.sideFrictionStiffness);
  }
  return car;
}

// The driver: steer at the destination, pick a speed that gets there by the end of the turn,
// and back up with the wheels turned the other way when the destination is far behind.
function drive(car: RAPIER.DynamicRayCastVehicleController, body: RAPIER.RigidBody, st: { steer: number; reverse: number }, dest: Vec | null): void {
  const speed = car.currentVehicleSpeed();
  let target = 0;
  let steerTo = 0;
  if (dest) {
    const p = body.translation();
    const dx = dest.x * S - p.x;
    const dz = dest.y * S - p.z;
    const ang = angleDiff(headingOf(body.rotation()), Math.atan2(dz, dx));
    if (st.reverse === 0 && Math.abs(ang) > D.reverseAbove * DEG && Math.abs(speed) < D.reverseBelow) st.reverse = Math.sign(ang) || 1;
    if (st.reverse !== 0 && Math.abs(ang) < D.reverseUntil * DEG) st.reverse = 0;
    const far = Math.hypot(dx, dz);
    if (far > D.arriveDistance) {
      target = st.reverse !== 0 ? -D.reverseSpeed : Math.min(T.maxSpeed, far / PHYSICS.turnSeconds);
      // Backing up turns the truck the opposite way from the wheels.
      steerTo = st.reverse !== 0 ? -st.reverse * T.maxSteer : clamp(ang * D.steerGain, -T.maxSteer, T.maxSteer);
    }
  }
  const step = T.steerRate * DT;
  st.steer = clamp(steerTo, st.steer - step, st.steer + step);
  // Positive wheel steering turns toward -z; map headings grow toward +z.
  car.setWheelSteering(0, -st.steer);
  car.setWheelSteering(1, -st.steer);

  const u = clamp((target - speed) * D.throttleGain, -1, 1);
  const pushing = target > 0 ? u > 0 : target < 0 ? u < 0 : false;
  for (let i = 0; i < 4; i++) car.setWheelBrake(i, pushing ? 0 : Math.abs(u) * T.brakeForce + (target === 0 ? T.brakeForce : 0));
  for (const i of [2, 3]) car.setWheelEngineForce(i, pushing ? u * T.engineForce : 0);
}

function frameOf(car: RAPIER.DynamicRayCastVehicleController, body: RAPIER.RigidBody): Frame {
  const wheels: WheelFrame[] = [];
  for (let i = 0; i < 4; i++) {
    wheels.push({ steer: car.wheelSteering(i) ?? 0, spin: car.wheelRotation(i) ?? 0, suspension: car.wheelSuspensionLength(i) ?? T.suspensionRest });
  }
  const t = body.translation();
  const r = body.rotation();
  return { pos: { x: t.x, y: t.y, z: t.z }, rot: { x: r.x, y: r.y, z: r.z, w: r.w }, wheels };
}

// Map heading grows from +x toward +z. A rotation about y by -heading turns +x onto it.
export function headingQuat(heading: number): Quat {
  return { x: 0, y: Math.sin(-heading / 2), z: 0, w: Math.cos(-heading / 2) };
}

export function headingOf(q: Quat): number {
  // The chassis forward axis +x, rotated by q, projected on the ground.
  const fx = 1 - 2 * (q.y * q.y + q.z * q.z);
  const fz = 2 * (q.x * q.z - q.w * q.y);
  return Math.atan2(fz, fx);
}

export function truckState(d: Drive): { pos: Vec; heading: number; speed: number } {
  const body = d.world.getRigidBody(d.body);
  const t = body.translation();
  const v = body.linvel();
  return { pos: { x: t.x / S, y: t.z / S }, heading: headingOf(body.rotation()), speed: Math.hypot(v.x, v.z) };
}

function addTerrain(world: RAPIER.World, w: World): void {
  const n = w.terrain.size;
  const vertices = new Float32Array((n + 1) * (n + 1) * 3);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const k = (j * (n + 1) + i) * 3;
      vertices[k] = i * S;
      vertices[k + 1] = w.terrain.heights[j * (n + 1) + i] * S;
      vertices[k + 2] = j * S;
    }
  }
  world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, terrainIndices(n)));
  // Walls at the map edge.
  const size = n * S;
  const wall = 50;
  for (const [x, z, hx, hz] of [[-wall, size / 2, wall, size], [size + wall, size / 2, wall, size], [size / 2, -wall, size, wall], [size / 2, size + wall, size, wall]]) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 200, hz).setTranslation(x, 0, z));
  }
}

// Two upward-facing triangles per tile over the (n + 1) x (n + 1) corner grid.
export function terrainIndices(n: number): Uint32Array {
  const idx = new Uint32Array(n * n * 6);
  let k = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      const b = a + 1;
      const c = a + n + 1;
      const d = c + 1;
      idx.set([a, c, b, b, c, d], k);
      k += 6;
    }
  }
  return idx;
}

function addObstacles(world: RAPIER.World, w: World): void {
  for (const o of w.obstacles) {
    const ground = heightAt(w.terrain, o.pos.x, o.pos.y) * S;
    const half = PHYSICS.rockHeight / 2;
    world.createCollider(RAPIER.ColliderDesc.cylinder(half, o.r * S).setTranslation(o.pos.x * S, ground + half - 0.5, o.pos.y * S));
  }
}
