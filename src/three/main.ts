// 3D physics driving test. Click the ground to pick where to drive. Space plays one turn.
// Time only moves while a turn plays. The line shows exactly what the next turn will do.

import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { CONFIG } from '../config';
import { PHYSICS } from '../data/physics';
import { buildDrive, freeDrive, initPhysics, simulateTurn, truckState, type Drive, type Frame } from '../phys/drive';
import { playerVehicle } from '../sim/damage';
import type { Vec } from '../sim/vec';
import { newWorld } from '../sim/world';
import { obstacleProps, terrainMesh } from './world3d';
import { Truck3D } from './truck3d';

const S = PHYSICS.metersPerTile;
const VIEW_METERS = 55; // world meters across the shorter screen side at zoom 1
const CAMERA_OFFSET = new THREE.Vector3(-1, 0.816, -1).normalize().multiplyScalar(300); // 30 degrees down, like the iso view
const ARRIVED_TILES = 0.9;
const PATH_WIDTH_PX = 4;

await initPhysics();
const world = newWorld(CONFIG.seed);
const me = playerVehicle(world);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1410);
scene.add(new THREE.HemisphereLight(0xfff0d8, 0x6a5038, 1.4));
const sun = new THREE.DirectionalLight(0xfff0d0, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
scene.add(sun, sun.target);

const ground = terrainMesh(world);
scene.add(ground, obstacleProps(world));
const truck = new Truck3D();
scene.add(truck.root);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2000);
let zoom = 1;

const hudEl = document.getElementById('hud');
if (!hudEl) throw new Error('Missing #hud');
const hud = hudEl;

// Physics state. The first idle turn lets the truck settle and gives a starting frame.
let drive: Drive = buildDrive(world, me.pos, me.heading);
let frame: Frame = settle();
let order: Vec | null = null;
let hover: Vec | null = null;
let turn = 0;
let anim: { frames: Frame[]; start: number; next: Drive } | null = null;

const orderLine = pathLine(0xf0d060, 1);
const hoverLine = pathLine(0xf0e0b8, 0.5);
const marker = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.6, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe05030 }));
marker.visible = false;
scene.add(orderLine, hoverLine, marker);

function settle(): Frame {
  const r = simulateTurn(drive, null);
  freeDrive(drive);
  drive = r.next;
  return r.frames[r.frames.length - 1];
}

function pathLine(color: number, opacity: number): Line2 {
  const line = new Line2(new LineGeometry(), new LineMaterial({ color, linewidth: PATH_WIDTH_PX, transparent: true, opacity, depthTest: false }));
  line.renderOrder = 10;
  line.visible = false;
  return line;
}

// Runs the turn a destination would give, without keeping it, and draws its path.
function preview(line: Line2, dest: Vec | null): void {
  line.visible = dest !== null;
  if (!dest) return;
  const r = simulateTurn(drive, dest);
  freeDrive(r.next);
  line.geometry.dispose();
  line.geometry = new LineGeometry().setPositions(r.frames.flatMap((f) => [f.pos.x, f.pos.y - 0.3, f.pos.z]));
  line.computeLineDistances();
}

function setOrder(dest: Vec | null): void {
  order = dest;
  marker.visible = dest !== null;
  if (dest) marker.position.set(dest.x * S, groundY(dest) + 0.2, dest.y * S);
  preview(orderLine, order);
}

function groundY(p: Vec): number {
  const hit = new THREE.Raycaster(new THREE.Vector3(p.x * S, 1000, p.y * S), new THREE.Vector3(0, -1, 0)).intersectObject(ground)[0];
  return hit ? hit.point.y : 0;
}

function endTurn(): void {
  if (anim) return;
  const r = simulateTurn(drive, order);
  anim = { frames: r.frames, start: performance.now(), next: r.next };
  orderLine.visible = false;
  hoverLine.visible = false;
}

function finishTurn(): void {
  if (!anim) throw new Error('No turn is playing');
  freeDrive(drive);
  drive = anim.next;
  frame = anim.frames[anim.frames.length - 1];
  anim = null;
  turn++;
  const s = truckState(drive);
  if (order && Math.hypot(s.pos.x - order.x, s.pos.y - order.y) < ARRIVED_TILES && s.speed < 0.5) setOrder(null);
  else setOrder(order);
  if (hover) preview(hoverLine, hover);
}

// Input: left click orders, right click clears the order, Space plays a turn, wheel zooms.
const pointer = new THREE.Vector2();
const ray = new THREE.Raycaster();
function groundUnder(e: MouseEvent): Vec | null {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(pointer, camera);
  const hit = ray.intersectObject(ground)[0];
  return hit ? { x: hit.point.x / S, y: hit.point.z / S } : null;
}
let hoverDirty = false;
window.addEventListener('pointermove', (e) => {
  hover = groundUnder(e);
  hoverDirty = true;
});
window.addEventListener('pointerdown', (e) => {
  if (anim) return;
  if (e.button === 0) setOrder(groundUnder(e));
  if (e.button === 2) setOrder(null);
});
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') endTurn();
});
window.addEventListener('wheel', (e) => {
  zoom = Math.min(4, Math.max(0.35, zoom * Math.exp(-e.deltaY * 0.001)));
  resize();
});

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  const half = VIEW_METERS / 2 / zoom;
  const aspect = w / h;
  Object.assign(camera, aspect >= 1 ? { left: -half * aspect, right: half * aspect, top: half, bottom: -half } : { left: -half, right: half, top: half / aspect, bottom: -half / aspect });
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const focus = new THREE.Vector3(frame.pos.x, frame.pos.y, frame.pos.z);
function tick(now: number): void {
  if (anim) {
    // The frame timestamp can predate the key press that started the turn.
    const i = Math.min(anim.frames.length - 1, Math.max(0, Math.floor(((now - anim.start) / 1000) * PHYSICS.stepsPerSecond)));
    frame = anim.frames[i];
    if (i === anim.frames.length - 1) finishTurn();
  } else if (hoverDirty) {
    hoverDirty = false;
    preview(hoverLine, hover);
  }
  truck.pose(frame);
  focus.lerp(new THREE.Vector3(frame.pos.x, frame.pos.y, frame.pos.z), 0.1);
  camera.position.copy(focus).add(CAMERA_OFFSET);
  camera.lookAt(focus);
  sun.position.copy(focus).add(new THREE.Vector3(-60, 120, -30));
  sun.target.position.copy(focus);
  const s = truckState(drive);
  const kmh = anim ? 0 : s.speed * 3.6;
  hud.textContent = `Turn ${turn}   ${anim ? 'driving...' : `${kmh.toFixed(0)} km/h`}\nClick: pick destination   Right click: clear   Space: play turn   Wheel: zoom`;
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

if (import.meta.env.DEV) (window as any).__KOROVAN_3D__ = { get drive() { return drive; }, get order() { return order; }, setOrder, endTurn, camera, world };
