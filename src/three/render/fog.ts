import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { TERRAIN } from '../../data/terrain';
import { PAL } from '../../render/palette';
import type { World } from '../../sim/types';
import type { RenderScope } from './scope';
import { TERRAIN_CHUNK } from './terrain';

const S = PHYSICS.metersPerTile;
const VISIBLE = 0;
const EXPLORED = 1;
const DARK = 2;
const UNSET = 255; // before the first update, so it writes every chunk

type FogChunk = { x: number; y: number; width: number; depth: number; alpha: THREE.BufferAttribute };

// Fog chunks keep the per-tile fog state they last drew. An update rewrites only the chunks whose
// vertices touch a tile with a changed state.
export class FogView {
  private readonly chunks: FogChunk[] = [];
  private readonly perSide: number;
  private readonly state: Uint8Array;
  private readonly dirty: Uint8Array;
  private readonly alphaOf = [0, TERRAIN.fog.dimAlpha, TERRAIN.fog.darkAlpha];

  constructor(world: World, scope: RenderScope) {
    const n = world.size;
    this.perSide = Math.ceil(n / TERRAIN_CHUNK);
    this.state = new Uint8Array(n * n).fill(UNSET);
    this.dirty = new Uint8Array(this.perSide * this.perSide);
    const c = new THREE.Color(PAL.bg);
    const material = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Vector3(c.r, c.g, c.b) } },
      vertexShader: 'attribute float alpha; varying float vAlpha; void main() { vAlpha = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 color; varying float vAlpha; void main() { gl_FragColor = vec4(color, vAlpha); }',
      transparent: true, depthTest: false, depthWrite: false,
    });
    for (let y = 0; y < n; y += TERRAIN_CHUNK) for (let x = 0; x < n; x += TERRAIN_CHUNK) {
      const width = Math.min(TERRAIN_CHUNK, n - x);
      const depth = Math.min(TERRAIN_CHUNK, n - y);
      const geo = new THREE.PlaneGeometry(width * S, depth * S, width, depth).rotateX(-Math.PI / 2);
      const pos = geo.getAttribute('position');
      for (let j = 0; j <= depth; j++) for (let i = 0; i <= width; i++) {
        pos.setXYZ(j * (width + 1) + i, (x + i) * S, world.terrain.heights[(y + j) * (n + 1) + x + i] * S + 0.03, (y + j) * S);
      }
      const alpha = new THREE.BufferAttribute(new Float32Array((width + 1) * (depth + 1)), 1);
      geo.setAttribute('alpha', alpha);
      geo.computeBoundingSphere();
      const chunk = new THREE.Mesh(geo, material);
      chunk.renderOrder = 900;
      chunk.matrixAutoUpdate = false;
      chunk.updateMatrix();
      scope.add(chunk, { x: x + width / 2, y: y + depth / 2 }, Math.hypot(width, depth) / 2);
      this.chunks.push({ x, y, width, depth, alpha });
    }
    this.update(world);
  }

  update(world: World): void {
    const n = world.size;
    const visible = new Uint8Array(n * n);
    for (const t of world.player.visible) visible[t] = 1;
    const explored = world.player.explored;
    const C = TERRAIN_CHUNK;
    for (let t = 0; t < n * n; t++) {
      const s = visible[t] ? VISIBLE : explored[t] ? EXPLORED : DARK;
      if (s === this.state[t]) continue;
      this.state[t] = s;
      // Tile (x, y) feeds the four vertices x..x+1, y..y+1. A vertex on a chunk border belongs to both chunks.
      const x = t % n;
      const y = (t - x) / n;
      const cx0 = x % C === 0 && x > 0 ? x / C - 1 : Math.floor(x / C);
      const cx1 = Math.min(Math.floor((x + 1) / C), this.perSide - 1);
      const cy0 = y % C === 0 && y > 0 ? y / C - 1 : Math.floor(y / C);
      const cy1 = Math.min(Math.floor((y + 1) / C), this.perSide - 1);
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) this.dirty[cy * this.perSide + cx] = 1;
    }
    for (let k = 0; k < this.chunks.length; k++) {
      if (!this.dirty[k]) continue;
      this.dirty[k] = 0;
      this.writeChunk(this.chunks[k], n);
    }
  }

  // Each vertex averages the fog of the up to four tiles around it.
  private writeChunk(chunk: FogChunk, n: number): void {
    const array = chunk.alpha.array as Float32Array;
    for (let j = 0; j <= chunk.depth; j++) for (let i = 0; i <= chunk.width; i++) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
        const x = chunk.x + i + dx;
        const y = chunk.y + j + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        sum += this.alphaOf[this.state[y * n + x]];
        count++;
      }
      array[j * (chunk.width + 1) + i] = sum / count;
    }
    chunk.alpha.needsUpdate = true;
  }
}
