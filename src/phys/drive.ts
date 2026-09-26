// Physics driving for every vehicle. The map's terrain and obstacles become Rapier colliders; each
// vehicle is a ray-cast car. Time only moves inside simulateTurn. A turn restores the world from a
// snapshot and runs it forward, so the same state and orders always give the same result: the
// preview is the turn itself.

import RAPIER from '@dimforge/rapier3d-compat';
import { chassisDef } from '../data/chassis';
import { PHYSICS } from '../data/physics';
import { RULES } from '../data/rules';
import { isDriveObstacle } from '../sim/mapgen';
import { getResources } from '../sim/resources';
import { vehicleMass } from '../sim/mass';
import { vehicleStats, type VehicleStats } from '../sim/stats';
import { route, straightClear } from '../sim/path';
import { aimPoint, parkedVehicles, shouldBackToDestination, zoneSpeed } from '../sim/steering';
import { heightAt } from '../sim/terrain';
import type { MoveOrder, Vehicle, World } from '../sim/types';
import { angleDiff, clamp, DEG, dist, type Vec } from '../sim/vec';
import { bodyOf, type Body } from '../sim/body';
import { wheelMounts } from './body';
import { headingOf, headingQuat, type TurnFrames, type VehicleFrame } from './frames';

const S = PHYSICS.metersPerTile;
const T = PHYSICS.truck;
const D = PHYSICS.driver;
const DT = 1 / PHYSICS.stepsPerSecond;
export const TURN_STEPS = Math.round(PHYSICS.turnSeconds * PHYSICS.stepsPerSecond);
const TELEPORT_TILES = 0.5; // a sim position this far from its body was moved by the rules, not by driving
const WALL = 50; // meters of wall thickness at the map edge
export const EDGE = 'edge'; // the crash target name for the map border

// Tiles per turn to meters per second, and back.
export const toMps = (tilesPerTurn: number) => (tilesPerTurn * S) / PHYSICS.turnSeconds;
export const toTilesPerTurn = (mps: number) => (mps * PHYSICS.turnSeconds) / S;

// The driver's memory between turns: current wheel angle, and whether it is backing toward its point.
type Memory = { steer: number; reverse: boolean };

// Everything a turn needs to start: the physics world, which body and collider belongs to which
// vehicle or obstacle, and each driver's memory.
export type Drive = {
  world: RAPIER.World;
  bodies: Record<string, number>; // vehicle id to rigid body handle
  obstacles: Record<string, number>; // obstacle id to collider handle
  memory: Record<string, Memory>;
  terrain: number; // terrain collider handle
};

export type Crash = { a: string; b: string; impact: number }; // b is a vehicle id, an obstacle id or 'edge'; impact in m/s
export type VehicleResult = { passed: boolean; arrived: boolean };
export type TurnResult = { next: Drive; frames: TurnFrames; crashes: Crash[]; results: Record<string, VehicleResult> };

export async function initPhysics(): Promise<void> {
  await RAPIER.init();
}

export function buildDrive(w: World): Drive {
  const world = new RAPIER.World({ x: 0, y: -PHYSICS.gravity, z: 0 });
  const d: Drive = { world, bodies: {}, obstacles: {}, memory: {}, terrain: addTerrain(world, w) };
  syncDrive(d, w);
  return d;
}

export function freeDrive(d: Drive): void {
  d.world.free();
}

// Brings the physics world in line with the sim: new and removed vehicles and obstacles, vehicle
// masses after loadout changes, and vehicles the rules moved, such as a defeated player waking up in town.
export function syncDrive(d: Drive, w: World): void {
  const ids = new Set(w.vehicles.map((v) => v.id));
  for (const [id, handle] of Object.entries(d.bodies)) {
    if (ids.has(id)) continue;
    d.world.removeRigidBody(d.world.getRigidBody(handle));
    delete d.bodies[id];
    delete d.memory[id];
  }
  for (const v of w.vehicles) {
    const handle = d.bodies[v.id];
    if (handle === undefined) {
      d.bodies[v.id] = addVehicle(d.world, w, v);
      d.memory[v.id] = { steer: 0, reverse: false };
      continue;
    }
    const body = d.world.getRigidBody(handle);
    setMass(body, v);
    const t = body.translation();
    if (dist({ x: t.x / S, y: t.z / S }, v.pos) > TELEPORT_TILES) placeBody(body, w, v);
  }
  const obstacleIds = new Set(w.obstacles.filter(isDriveObstacle).map((o) => o.id));
  for (const [id, handle] of Object.entries(d.obstacles)) {
    if (obstacleIds.has(id)) continue;
    d.world.removeCollider(d.world.getCollider(handle), false);
    delete d.obstacles[id];
  }
  // Only obstacles that block driving get colliders. Site props are scenery; the site boundary blocks instead.
  for (const o of w.obstacles.filter(isDriveObstacle)) {
    if (d.obstacles[o.id] !== undefined) continue;
    const ground = heightAt(w.terrain, o.pos.x, o.pos.y) * S;
    const half = PHYSICS.rockHeight / 2;
    const desc = RAPIER.ColliderDesc.cylinder(half, o.r * S).setTranslation(o.pos.x * S, ground + half - PHYSICS.rockSink, o.pos.y * S);
    d.obstacles[o.id] = d.world.createCollider(desc).handle;
  }
}

function addVehicle(world: RAPIER.World, w: World, v: Vehicle): number {
  const b = bodyOf(v.chassisId);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setGravityScale(T.gravityScale));
  const collider = RAPIER.ColliderDesc.cuboid(b.half.x, b.half.y, b.half.z).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
  world.createCollider(collider, body);
  setMass(body, v);
  placeBody(body, w, v);
  return body.handle;
}

// Mass from the vehicle's load, with box inertia per axis, scaled up, around a center of mass lowered toward the axles.
function setMass(body: RAPIER.RigidBody, v: Vehicle): void {
  const h = bodyOf(v.chassisId).half;
  const mass = vehicleMass(v);
  const k = (mass / 3) * T.inertiaScale; // m/12 * (2a)^2 = m/3 * a^2
  const inertia = { x: k * (h.y * h.y + h.z * h.z), y: k * (h.x * h.x + h.z * h.z), z: k * (h.x * h.x + h.y * h.y) };
  body.collider(0).setMassProperties(mass, { x: 0, y: -T.comBelow, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 });
  body.recomputeMassPropertiesFromColliders();
}

function placeBody(body: RAPIER.RigidBody, w: World, v: Vehicle): void {
  body.setTranslation({ x: v.pos.x * S, y: rideHeight(w, v), z: v.pos.y * S }, true);
  body.setRotation(headingQuat(v.heading), true);
  const fwd = toMps(v.speed);
  body.setLinvel({ x: Math.cos(v.heading) * fwd, y: 0, z: Math.sin(v.heading) * fwd }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

// Runs one turn of the sim's orders from a copy of the physics world. The input drive stays untouched.
// Call syncDrive first so the physics world matches the sim.
export function simulateTurn(d: Drive, w: World): TurnResult {
  return run(d, w, TURN_STEPS);
}

type Car = { v: Vehicle; s: VehicleStats; b: Body; body: RAPIER.RigidBody; ctl: RAPIER.DynamicRayCastVehicleController; mem: Memory; plan: Plan; result: VehicleResult };

function run(d: Drive, w: World, steps: number): TurnResult {
  const world = RAPIER.World.restoreSnapshot(d.world.takeSnapshot());
  world.timestep = DT;
  const events = new RAPIER.EventQueue(true);
  const memory: Record<string, Memory> = structuredClone(d.memory);
  const cars: Car[] = w.vehicles.map((v) => {
    const handle = d.bodies[v.id];
    if (handle === undefined) throw new Error(`Vehicle ${v.id} has no physics body; call syncDrive first`);
    const body = world.getRigidBody(handle);
    const s = vehicleStats(w, v);
    const b = bodyOf(v.chassisId);
    const mem = memory[v.id];
    return { v, s, b, body, ctl: makeCar(world, body, b, s.mass), mem, plan: planTurn(w, v, s, body, v.order), result: { passed: false, arrived: false } };
  });
  const owner = new Map<number, string>(); // collider handle to vehicle id
  for (const c of cars) owner.set(c.body.collider(0).handle, c.v.id);
  const obstacleOf = new Map(Object.entries(d.obstacles).map(([id, h]) => [h, id]));

  const frames: TurnFrames = Object.fromEntries(cars.map((c) => [c.v.id, [] as VehicleFrame[]]));
  const crashes: Crash[] = [];
  const crashed = new Set<string>(); // one crash per pair per turn
  for (let i = 0; i < steps; i++) {
    const before = new Map(cars.map((c) => [c.v.id, c.body.linvel()]));
    for (const c of cars) driveStep(c);
    for (const c of cars) c.ctl.updateVehicle(DT);
    world.step(events);
    events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const crash = crashOf(h1, h2, owner, obstacleOf, d.terrain, before);
      if (!crash) return;
      const key = [crash.a, crash.b].sort().join('|');
      if (crashed.has(key)) return;
      crashed.add(key);
      crashes.push(crash);
    });
    for (const c of cars) frames[c.v.id].push(frameOf(c.ctl, c.body));
  }
  for (const c of cars) world.removeVehicleController(c.ctl);
  events.free();
  const results = Object.fromEntries(cars.map((c) => [c.v.id, c.result]));
  return { next: { world, bodies: { ...d.bodies }, obstacles: { ...d.obstacles }, memory, terrain: d.terrain }, frames, crashes, results };
}

function crashOf(h1: number, h2: number, owner: Map<number, string>, obstacleOf: Map<number, string>, terrain: number, before: Map<string, RAPIER.Vector>): Crash | null {
  const a = owner.get(h1) ?? owner.get(h2);
  if (a === undefined) return null;
  const other = owner.get(h1) === a ? h2 : h1;
  if (other === terrain) return null;
  const va = before.get(a)!;
  const b = owner.get(other) ?? obstacleOf.get(other) ?? EDGE;
  const vb = owner.has(other) ? before.get(b)! : { x: 0, y: 0, z: 0 };
  return { a, b, impact: Math.hypot(va.x - vb.x, va.z - vb.z) };
}

function makeCar(world: RAPIER.World, body: RAPIER.RigidBody, b: Body, mass: number): RAPIER.DynamicRayCastVehicleController {
  const car = world.createVehicleController(body);
  for (const m of wheelMounts(b)) {
    const i = car.numWheels();
    car.addWheel(m, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, T.suspensionRest, b.wheelRadius);
    car.setWheelMaxSuspensionTravel(i, T.suspensionTravel);
    car.setWheelSuspensionStiffness(i, T.suspensionStiffness);
    car.setWheelSuspensionCompression(i, T.suspensionCompression);
    car.setWheelSuspensionRelaxation(i, T.suspensionRelaxation);
    car.setWheelMaxSuspensionForce(i, T.maxSuspensionForce * (mass / 1000));
    car.setWheelFrictionSlip(i, T.frictionSlip);
    car.setWheelSideFrictionStiffness(i, T.sideFrictionStiffness);
  }
  return car;
}

// What a driver wants this turn, fixed at the start of the turn like the 2D rules: a destination to
// steer at, and a speed from the throttle zone of the click. Without fuel the engine gives nothing.
// route holds waypoints around obstacles when the straight line to dest is blocked, else null.
type Plan = { dest: Vec | null; route: Vec[] | null; target: number; stopAt: boolean; engine: boolean; maxSteer: number; engineForce: number; brakeForce: number; stopDecel: number };

function planTurn(w: World, v: Vehicle, full: VehicleStats, body: RAPIER.RigidBody, order: MoveOrder | null): Plan {
  const ch = chassisDef(v.chassisId);
  const speed = Math.max(0, toTilesPerTurn(forwardSpeed(body)));
  const s = fuelLimited(w, v, full, speed, order);
  const engine = s.maxSpeed > 0;
  // The stats accel already falls with load, so the engine force stays fixed as mass grows.
  // Brakes grip with a force sized for the rated mass, so a heavy truck brakes worse.
  const base = {
    engine,
    maxSteer: T.maxSteer * (s.turnSlow / (ch.turnSlow * DEG)),
    engineForce: (full.mass * T.engineAccel * (s.accel / ch.accel)) / 2,
    brakeForce: T.brakeForce * (ch.ratedMass / 1000),
    stopDecel: D.stopDecel * (ch.ratedMass / full.mass), // the stop plan brakes as hard as this load allows
  };
  if (!order) return { ...base, dest: null, route: null, target: toMps(speed), stopAt: false };
  if (order.kind === 'brake') return { ...base, dest: null, route: null, target: 0, stopAt: false };
  // Careful drivers follow the route planner around obstacles; careless ones drive straight.
  const parked = parkedVehicles(w, v.id);
  const path = v.direct || straightClear(w, v.pos, order.dest, s.radius, parked) ? null : route(w, v.pos, order.dest, s.radius, parked);
  if (order.kind === 'stopAt') return { ...base, dest: order.dest, route: path, target: toMps(Math.min(s.maxSpeed, speed + s.accel)), stopAt: true };
  const next = zoneSpeed(s, speed, dist(v.pos, order.dest));
  return { ...base, dest: order.dest, route: path, target: toMps(next), stopAt: false };
}

// Fuel limits the engine like the 2D rules: under the low-fuel share of the tank the top
// speed halves, and a tank that cannot cover this turn's drive still lets the truck crawl.
function fuelLimited(w: World, v: Vehicle, s: VehicleStats, speed: number, order: MoveOrder | null): VehicleStats {
  const fuel = getResources(w, v).fuel;
  const low = fuel > 0 && fuel < chassisDef(v.chassisId).fuelCap * RULES.lowFuelThreshold;
  const limit = low ? Math.max(s.maxSpeed * RULES.lowFuelSpeedFactor, speed - s.brake) : s.maxSpeed;
  const capped = low ? { ...s, maxSpeed: limit } : s;
  const wanted = order?.kind === 'through' ? zoneSpeed(capped, speed, dist(v.pos, order.dest)) : Math.min(capped.maxSpeed, speed + capped.accel);
  if (wanted * s.fuelPerTile <= fuel) return capped;
  const cap = Math.max(RULES.crawlSpeed, speed - s.brake);
  return { ...s, maxSpeed: cap, accel: Math.min(s.accel, RULES.crawlSpeed) };
}

// One physics step of driving. Steer at the destination and hold the turn's speed. A stop order slows
// to arrive. A slow truck with the destination far behind backs up, wheels turned the other way.
// A drive-through point counts as passed only once close; a side click behind the truck still steers.
function driveStep(c: Car): void {
  const { plan, mem, body, ctl } = c;
  const speed = forwardSpeed(body);
  let target = plan.target;
  let steerTo = 0;
  if (plan.dest && !c.result.passed && !c.result.arrived) {
    const p = body.translation();
    const far = Math.hypot(plan.dest.x * S - p.x, plan.dest.y * S - p.z);
    // Steer at the next route point far enough ahead, or at the destination.
    const aim = plan.route ? aimPoint({ x: p.x / S, y: p.z / S }, plan.route) : plan.dest;
    const dx = aim.x * S - p.x;
    const dz = aim.y * S - p.z;
    const heading = headingOf(body.rotation());
    const ang = angleDiff(heading, Math.atan2(dz, dx));
    if (plan.stopAt) {
      target = Math.min(target, Math.sqrt(2 * plan.stopDecel * Math.max(0, far - RULES.arriveRadius * S)));
      if (far < RULES.arriveRadius * S) c.result.arrived = true;
    } else if (far < RULES.passRadius * S) {
      c.result.passed = true;
    }
    if (!c.result.passed && !c.result.arrived) {
      // Reverse until the route is ahead. Ordinary NPCs steer their nose toward it, while
      // player orders and blockage recovery aim the rear at the destination.
      const behind = Math.abs(ang) > Math.PI / 2;
      if (!mem.reverse && target > 0 && behind && Math.abs(speed) < D.reverseBelow) mem.reverse = true;
      if (mem.reverse && !behind) mem.reverse = false;
      if (mem.reverse) {
        target = -Math.min(D.reverseSpeed, plan.target);
        // Backing up turns the truck the opposite way from the wheels.
        const rearAng = angleDiff(heading + Math.PI, Math.atan2(dz, dx));
        const turnAngle = shouldBackToDestination(c.v) ? rearAng : ang;
        steerTo = clamp(-turnAngle * D.steerGain, -plan.maxSteer, plan.maxSteer);
      } else {
        steerTo = clamp(ang * D.steerGain, -plan.maxSteer, plan.maxSteer);
      }
    }
  }
  if (c.result.arrived) target = 0;
  if (!plan.dest) mem.reverse = false;
  const step = T.steerRate * DT;
  mem.steer = clamp(steerTo, mem.steer - step, mem.steer + step);
  // Positive wheel steering turns toward -z; map headings grow toward +z.
  ctl.setWheelSteering(0, -mem.steer);
  ctl.setWheelSteering(1, -mem.steer);

  const u = clamp((target - speed) * D.throttleGain, -1, 1);
  const pushing = plan.engine && (target > 0 ? u > 0 : target < 0 ? u < 0 : false);
  const brake = pushing ? 0 : Math.abs(u) * plan.brakeForce + (target === 0 ? plan.brakeForce : 0);
  for (let i = 0; i < 4; i++) ctl.setWheelBrake(i, brake);
  for (const i of [2, 3]) ctl.setWheelEngineForce(i, pushing ? u * plan.engineForce : 0);
}

// Speed along the truck's nose, m/s; negative when backing up.
export function forwardSpeed(body: RAPIER.RigidBody): number {
  const v = body.linvel();
  const h = headingOf(body.rotation());
  return v.x * Math.cos(h) + v.z * Math.sin(h);
}

function frameOf(car: RAPIER.DynamicRayCastVehicleController, body: RAPIER.RigidBody): VehicleFrame {
  const wheels = [];
  for (let i = 0; i < car.numWheels(); i++) {
    wheels.push({ steer: car.wheelSteering(i) ?? 0, spin: car.wheelRotation(i) ?? 0, suspension: car.wheelSuspensionLength(i) ?? T.suspensionRest });
  }
  const t = body.translation();
  const r = body.rotation();
  return { pos: { x: t.x, y: t.y, z: t.z }, rot: { x: r.x, y: r.y, z: r.z, w: r.w }, wheels };
}

// A vehicle standing on the ground at its sim pose, wheels at rest. For vehicles that have not
// driven a turn yet, such as ones that spawned at the end of the last turn.
export function restFrame(w: World, v: Vehicle): VehicleFrame {
  const b = bodyOf(v.chassisId);
  const q = headingQuat(v.heading);
  const wheels = wheelMounts(b).map(() => ({ steer: 0, spin: 0, suspension: T.suspensionRest }));
  return { pos: { x: v.pos.x * S, y: rideHeight(w, v), z: v.pos.y * S }, rot: q, wheels };
}

// Height of the body center for a truck standing at its sim position with springs at rest.
function rideHeight(w: World, v: Vehicle): number {
  const b = bodyOf(v.chassisId);
  return heightAt(w.terrain, v.pos.x, v.pos.y) * S + b.wheelRadius + T.suspensionRest - b.wheelY;
}

// Map pose and speed of a vehicle's body.
export function bodyState(d: Drive, id: string): { pos: Vec; heading: number; speed: number } {
  const handle = d.bodies[id];
  if (handle === undefined) throw new Error(`No physics body for ${id}`);
  const body = d.world.getRigidBody(handle);
  const t = body.translation();
  return { pos: { x: t.x / S, y: t.z / S }, heading: headingOf(body.rotation()), speed: forwardSpeed(body) };
}

function addTerrain(world: RAPIER.World, w: World): number {
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
  const terrain = world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, terrainIndices(n))).handle;
  const size = n * S;
  for (const [x, z, hx, hz] of [[-WALL, size / 2, WALL, size], [size + WALL, size / 2, WALL, size], [size / 2, -WALL, size, WALL], [size / 2, size + WALL, size, WALL]]) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, PHYSICS.wallHeight, hz).setTranslation(x, 0, z));
  }
  return terrain;
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
