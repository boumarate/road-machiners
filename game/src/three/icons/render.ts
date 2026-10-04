// Draws one item or chassis icon from the game's own models, for npm run icons.
// The style follows the view. A top-down icon is a blueprint: each material fills light or dark by its luminance, and
// the silhouette outline and the creases from a normal and depth pass draw as lines, all in the three BLUEPRINT colors.
// A diagonal icon is toon: each model keeps its flat colors through a three-step ramp under one key light, with a dark
// outline and darkened creases. Defs drawn by the same models are told apart by hatching inside the silhouette.
// Body space as in vehicle.ts: +x is the nose, +z the truck's right, +y up.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { BLUEPRINT, FACTION_COLORS, PAL } from '../../render/palette';
import { renderKey, type IconEntry } from '../../render/partLooks';
import { model, socket, type ModelName } from '../render/models';
import { weaponHead } from '../render/weaponHead';

// Bump when a change here alters how icons look, so the manifest test asks for npm run icons.
export const ICON_STYLE_VERSION = 3;

// top: straight down, nose up, like the inventory grid. diagonal: from the right side with the nose to the image's
// right, turned DIAGONAL_YAW_DEG toward the rear and raised DIAGONAL_PITCH_DEG, so a barrel reads lower left to upper right.
export type IconView = 'top' | 'diagonal';
export const DIAGONAL_YAW_DEG = 20;
export const DIAGONAL_PITCH_DEG = 20;

// The view the game shows per category: equipment top-down like the truck grid, cargo goods and the shop's truck
// portraits diagonal. Flip one and rerun npm run icons.
export type IconCategory = 'part' | 'good' | 'chassis';
export const ICON_VIEWS: Record<IconCategory, IconView> = { part: 'top', good: 'diagonal', chassis: 'diagonal' };

// The one owner of how each view is drawn: top-down as a blueprint in the glyph colors, diagonal as toon.
export type IconStyle = 'blueprint' | 'toon';
export const ICON_STYLES: Record<IconView, IconStyle> = { top: 'blueprint', diagonal: 'toon' };

// How a weapon lies in its grid box. upright: the mount on the rotation-0 footprint. lying: the mount turned and
// stretched to the rotation-1 footprint, as the truck view places it. The head never turns, so its barrel stays to the
// nose. Only weapons lie, since other parts turn their whole icon in the grid.
export type IconLie = 'upright' | 'lying';

// The one owner of which view the game shows for an entry.
export function iconView(entry: IconEntry): IconView {
  return ICON_VIEWS[iconCategory(entry)];
}

function iconCategory(entry: IconEntry): IconCategory {
  if (entry.section === 'good') return 'good';
  if (entry.section === 'chassis') return 'chassis';
  return 'part';
}

const CELL = PHYSICS.cell;
const ROT_YAW = Math.PI / 2; // a lying mount's turn, ROT_YAW in src/three/render/vehicle.ts
const SUPERSAMPLE = 2; // drawn at this multiple of the cell, then scaled down
// Share of the cell left empty on each side, room for the outline. The manifest carries it and OUTLINE_PX.
export const MARGIN = 0.1;
export const OUTLINE_PX = 4; // silhouette outline width at cell size, about 1 px at 36 px
const RAMP = [0.45, 0.75, 1]; // toon light steps
const CREASE_NORMAL = 0.35; // normal change, as color distance in the normal pass, that draws a crease
const CREASE_DEPTH = 6; // depth step, in 8-bit depth levels, that draws a crease
const CREASE_SHADE = 0.45; // toon crease pixels keep this share of their color
const INK = PAL.outline;
// A blueprint material at or above this luminance (0-1, of its sRGB color) fills light, below it dark, so tires and
// dark metal read dark and plates and frames light.
const BLUEPRINT_LIGHT_FROM = 0.3;
// Hatching per rank above 1: the gap between 45° lines and their width, as shares of the cell, and whether a second set
// crosses them. Denser with rank.
const HATCH: Record<number, { gap: number; width: number; cross: boolean }> = {
  2: { gap: 0.16, width: 0.025, cross: false },
  3: { gap: 0.1, width: 0.025, cross: false },
  4: { gap: 0.1, width: 0.025, cross: true },
};
const LINE: Record<IconStyle, number> = { blueprint: BLUEPRINT.line, toon: INK }; // outline, crease and hatch color
const GLASS_COLOR = 0x6a7a80; // cab windows, which the game tints by daylight
const PAINT = 'paint';
const TRIM = 'trim';
const GLASS = 'glass';

export type Pixels = { w: number; h: number; data: Uint8ClampedArray };
type Vec2 = { x: number; y: number };

// The barrel's head socket and tip as drawn, and the drawn pixel farthest along the barrel, all in cell pixels.
export type BarrelRead = { head: Vec2; tip: Vec2; pixelTip: Vec2 };

let shared: { renderer: THREE.WebGLRenderer; ramp: THREE.DataTexture } | null = null;

function renderer(): { renderer: THREE.WebGLRenderer; ramp: THREE.DataTexture } {
  if (shared) return shared;
  const r = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
  r.setClearColor(0x000000, 0);
  const ramp = new THREE.DataTexture(new Uint8Array(RAMP.map((v) => Math.round(v * 255))), RAMP.length, 1, THREE.RedFormat);
  ramp.minFilter = THREE.NearestFilter;
  ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  shared = { renderer: r, ramp };
  return shared;
}

// The icon at size x size pixels, with a transparent background, and the full-size drawing before the downscale.
export function renderIcon(entry: IconEntry, view: IconView, size: number, lie: IconLie = 'upright'): { icon: HTMLCanvasElement; drawn: Pixels } {
  const big = size * SUPERSAMPLE;
  const style = ICON_STYLES[view];
  const { scene, camera } = stage(entry, view, lie);
  const color = draw(scene, camera, big, null);
  const normal = draw(scene, camera, big, new THREE.MeshNormalMaterial({ flatShading: true }));
  const depth = draw(scene, camera, big, new THREE.MeshDepthMaterial());
  ink(color, normal, depth, OUTLINE_PX * SUPERSAMPLE, style);
  if (entry.rank > 1) hatch(color, entry.rank, LINE[style]);
  return { icon: shrink(color, size), drawn: color };
}

// How many pixels are neither transparent nor exactly one of the palette's colors.
export function paletteMisses({ data }: Pixels, palette: readonly number[]): number {
  let misses = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const rgb = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    if (data[i + 3] !== 255 || !palette.includes(rgb)) misses++;
  }
  return misses;
}

// Where the barrel reads in the drawn icon, for the orientation check. Weapons only.
export function barrelReads(entry: IconEntry, view: IconView, size: number): BarrelRead {
  if (!entry.weapon) throw new Error(`Icon ${entry.id} is not a weapon`);
  const { scene, camera, head, tip } = stage(entry, view, 'upright');
  const toPx = (p: THREE.Vector3): Vec2 => {
    const ndc = p.clone().project(camera);
    return { x: ((ndc.x + 1) / 2) * size, y: ((1 - ndc.y) / 2) * size };
  };
  const at = { head: toPx(head), tip: toPx(tip) };
  const color = draw(scene, camera, size, null);
  return { ...at, pixelTip: farthestAlong(color, at.head, at.tip) };
}

type Stage = { scene: THREE.Scene; camera: THREE.OrthographicCamera; head: THREE.Vector3; tip: THREE.Vector3 };

function stage(entry: IconEntry, view: IconView, lie: IconLie): Stage {
  const scene = new THREE.Scene();
  const { root, head, tip } = build(entry, lie);
  toon(root, ICON_STYLES[view]);
  scene.add(root);
  const camera = frame(root, view);
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  // Lit from the viewer's upper left, the same for every icon in a view.
  key.position.copy(camera.position).add(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(40));
  key.position.add(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(-25));
  scene.add(key, new THREE.AmbientLight(0xffffff, 1.1));
  return { scene, camera, head, tip };
}

// A weapon is its mount stretched to fill the def's footprint, with the head at its authored size on the mount's head
// socket, aimed forward. The stretch shows the footprint, so weapons of one look but different sizes differ. Lying, the
// mount turns by ROT_YAW and stretches to the turned footprint like footprint() in vehicle.ts places it: its local x
// spans the h cells across the truck and its local z the w cells along it. The head stays unturned, barrel to the nose.
function build(entry: IconEntry, lie: IconLie): { root: THREE.Group; head: THREE.Vector3; tip: THREE.Vector3 } {
  const root = new THREE.Group();
  if (!entry.weapon) {
    if (lie !== 'upright') throw new Error(`Icon ${entry.id} is not a weapon, so it has no ${lie} cell`);
    for (const name of entry.models) root.add(model(name));
    return { root, head: new THREE.Vector3(), tip: new THREE.Vector3() };
  }
  const look = entry.weapon;
  const mount = model(look.mount);
  const size = new THREE.Box3().setFromObject(mount).getSize(new THREE.Vector3());
  const { w, h } = entry.footprint;
  if (lie === 'upright') mount.scale.set((h * CELL.along) / size.x, 1, (w * CELL.across) / size.z);
  else {
    mount.scale.set((h * CELL.across) / size.x, 1, (w * CELL.along) / size.z);
    mount.rotation.y = ROT_YAW;
  }
  mount.updateMatrix();
  root.add(mount);
  const built = weaponHead(look);
  const at = socket(look.mount, 'head').applyMatrix4(mount.matrix);
  built.head.position.copy(at);
  root.add(built.head);
  return { root, head: at.clone(), tip: built.tip.add(at) };
}

// Swaps every material for the style's. Toon keeps the material's color on the light ramp. Blueprint fills unlit, light
// or dark by the material's luminance. Faction paint counts as its color in both.
function toon(root: THREE.Object3D, style: IconStyle): void {
  const { ramp } = renderer();
  const paint = FACTION_COLORS.player;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const old = o.material as THREE.MeshLambertMaterial;
    const color = { [PAINT]: paint.top, [TRIM]: paint.cab, [GLASS]: GLASS_COLOR }[old.name] ?? old.color.getHex();
    if (style === 'toon') o.material = new THREE.MeshToonMaterial({ color, gradientMap: ramp });
    else o.material = new THREE.MeshBasicMaterial({ color: blueprintFill(color) });
    old.dispose();
  });
}

function blueprintFill(color: number): number {
  const [r, g, b] = [(color >> 16) & 255, (color >> 8) & 255, color & 255].map((c) => c / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b >= BLUEPRINT_LIGHT_FROM ? BLUEPRINT.light : BLUEPRINT.dark;
}

// An orthographic camera that fits the model's vertices to the cell with MARGIN on each side.
function frame(root: THREE.Object3D, view: IconView): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  camera.position.copy(center).add(viewDir(view).multiplyScalar(30));
  if (view === 'top') camera.up.set(1, 0, 0);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  const p = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const pos = o.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) bounds.expandByPoint(camera.worldToLocal(p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld)));
  });
  const half = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y) / 2 / (1 - 2 * MARGIN);
  const mid = bounds.getCenter(new THREE.Vector3());
  camera.left = mid.x - half;
  camera.right = mid.x + half;
  camera.top = mid.y + half;
  camera.bottom = mid.y - half;
  // Depth runs over the model alone, so the 8-bit depth pass has its full range for creases.
  camera.near = -bounds.max.z - 0.01;
  camera.far = -bounds.min.z + 0.01;
  camera.updateProjectionMatrix();
  return camera;
}

// From the model toward the camera.
function viewDir(view: IconView): THREE.Vector3 {
  if (view === 'top') return new THREE.Vector3(0, 1, 0);
  const yaw = DIAGONAL_YAW_DEG * THREE.MathUtils.DEG2RAD;
  const pitch = DIAGONAL_PITCH_DEG * THREE.MathUtils.DEG2RAD;
  // The side view looks from +z, the truck's right, so +x is the image's right. Yaw moves it toward -x, the rear.
  return new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
}

function draw(scene: THREE.Scene, camera: THREE.Camera, size: number, override: THREE.Material | null): Pixels {
  const { renderer: r } = renderer();
  r.setSize(size, size, false);
  scene.overrideMaterial = override;
  r.render(scene, camera);
  scene.overrideMaterial = null;
  override?.dispose();
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = context(canvas);
  ctx.drawImage(r.domElement, 0, 0);
  return { w: size, h: size, data: ctx.getImageData(0, 0, size, size).data };
}

// Marks creases where the normal or depth pass jumps, then rings the silhouette in the style's line color. Toon darkens
// creases toward INK. Blueprint draws them as full line pixels, and sets every other solid pixel to the fill it is
// nearest of light and dark, the two colors its unlit materials draw, so the cell holds only BLUEPRINT colors.
function ink(color: Pixels, normal: Pixels, depth: Pixels, outline: number, style: IconStyle): void {
  const solid = solidOf(color);
  const crease = maskOf(color, (x, y) => solid(x, y) && (jumps(normal, depth, x, y, x + 1, y) || jumps(normal, depth, x, y, x, y + 1)));
  const ring = maskOf(color, (x, y) => !solid(x, y) && nearSolid(solid, x, y, outline));
  const line = rgbOf(LINE[style]);
  const { data } = color;
  for (let i = 0; i < ring.length; i++) {
    const at = i * 4;
    if (ring[i]) data.set([...line, 255], at);
    else if (style === 'blueprint') data.set(blueprintPixel(data, at, solid(i % color.w, Math.floor(i / color.w)), crease[i] === 1), at);
    else toonPixel(data, at, crease[i] === 1, line);
  }
}

// A toon pixel inside the ring: a crease darkens toward the line color, and any drawn pixel turns opaque.
function toonPixel(data: Uint8ClampedArray, at: number, crease: boolean, line: readonly number[]): void {
  if (crease) for (let c = 0; c < 3; c++) data[at + c] = Math.round(data[at + c] * CREASE_SHADE + line[c] * (1 - CREASE_SHADE));
  else if (data[at + 3] > 0) data[at + 3] = 255;
}

// A blueprint pixel inside the ring: a crease line, the fill its material drew, or transparent.
function blueprintPixel(data: Uint8ClampedArray, at: number, solid: boolean, crease: boolean): number[] {
  if (!solid) return [0, 0, 0, 0];
  if (crease) return [...rgbOf(BLUEPRINT.line), 255];
  const dist = (color: number): number => rgbOf(color).reduce((sum, c, i) => sum + Math.abs(c - data[at + i]), 0);
  return [...rgbOf(dist(BLUEPRINT.light) <= dist(BLUEPRINT.dark) ? BLUEPRINT.light : BLUEPRINT.dark), 255];
}

function rgbOf(color: number): [number, number, number] {
  return [(color >> 16) & 255, (color >> 8) & 255, color & 255];
}

function solidOf({ w, h, data }: Pixels): (x: number, y: number) => boolean {
  return (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] > 127;
}

function maskOf({ w, h }: Pixels, test: (x: number, y: number) => boolean): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = test(x, y) ? 1 : 0;
  return mask;
}

function jumps(normal: Pixels, depth: Pixels, x0: number, y0: number, x1: number, y1: number): boolean {
  if (x1 >= normal.w || y1 >= normal.h) return false;
  const a = (y0 * normal.w + x0) * 4;
  const b = (y1 * normal.w + x1) * 4;
  if (normal.data[b + 3] === 0) return false;
  let d = 0;
  for (let c = 0; c < 3; c++) d += ((normal.data[a + c] - normal.data[b + c]) / 255) ** 2;
  return Math.sqrt(d) > CREASE_NORMAL || Math.abs(depth.data[a] - depth.data[b]) > CREASE_DEPTH;
}

function nearSolid(solid: (x: number, y: number) => boolean, x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r && solid(x + dx, y + dy)) return true;
  }
  return false;
}

function shrink(src: Pixels, size: number): HTMLCanvasElement {
  const full = document.createElement('canvas');
  full.width = src.w;
  full.height = src.h;
  context(full).putImageData(new ImageData(new Uint8ClampedArray(src.data), src.w, src.h), 0, 0);
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = context(out);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, 0, 0, size, size);
  return out;
}

// 45° lines in color across every drawn pixel, denser with rank, crossed at the top rank. They never reach past the
// drawing, so they never change its extent.
function hatch(pixels: Pixels, rank: number, color: number): void {
  const lines = hatchLines(rank, pixels.w);
  const rgb = rgbOf(color);
  const solid = solidOf(pixels);
  for (let y = 0; y < pixels.h; y++) {
    for (let x = 0; x < pixels.w; x++) if (solid(x, y) && lines(x, y)) pixels.data.set([...rgb, 255], (y * pixels.w + x) * 4);
  }
}

// Whether a pixel of a size-wide cell lies on one of rank's hatch lines.
function hatchLines(rank: number, size: number): (x: number, y: number) => boolean {
  const spec = HATCH[rank];
  if (!spec) throw new Error(`No hatching for rank ${rank}`);
  const gap = spec.gap * size;
  const width = spec.width * size;
  const on = (d: number): boolean => ((d % gap) + gap) % gap < width;
  return (x, y) => on(x + y) || (spec.cross && on(x - y));
}

function farthestAlong(px: Pixels, head: Vec2, tip: Vec2): Vec2 {
  const len = Math.hypot(tip.x - head.x, tip.y - head.y);
  if (len === 0) throw new Error('Barrel tip and head project to one pixel');
  const dir = { x: (tip.x - head.x) / len, y: (tip.y - head.y) / len };
  let best = { x: head.x, y: head.y };
  let far = -Infinity;
  for (let y = 0; y < px.h; y++) {
    for (let x = 0; x < px.w; x++) {
      if (px.data[(y * px.w + x) * 4 + 3] === 0) continue;
      const along = (x - head.x) * dir.x + (y - head.y) * dir.y;
      if (along > far) [far, best] = [along, { x, y }];
    }
  }
  return best;
}

export function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D canvas context');
  return ctx;
}

export function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

// The same FNV-1a as scripts/shape-lib.mjs.
function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

// What an icon is drawn from: the style version, its view, its lie, its render key and the bytes of every model it
// draws. The manifest stores it so a test can tell when a model or pick changed without npm run icons.
export function iconHash(entry: IconEntry, view: IconView, modelBytes: (name: ModelName) => Uint8Array, lie: IconLie = 'upright'): string {
  const files = entry.models.map((name) => fnv1a(modelBytes(name))).join(',');
  return fnv1a(new TextEncoder().encode(`${ICON_STYLE_VERSION}|${view}|${lie}|${renderKey(entry)}|${files}`));
}
