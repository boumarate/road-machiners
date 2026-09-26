import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { TERRAIN } from '../../data/terrain';
import { PAL } from '../../render/palette';
import type { World } from '../../sim/types';
import { TERRAIN_CHUNK } from './terrain';

const S = PHYSICS.metersPerTile;

export class FogView {
  readonly mesh = new THREE.Group();
  private readonly chunks: { x: number; y: number; width: number; depth: number; alpha: THREE.BufferAttribute }[] = [];

  constructor(world: World) {
    const c = new THREE.Color(PAL.bg);
    const material = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Vector3(c.r, c.g, c.b) } },
      vertexShader: 'attribute float alpha; varying float vAlpha; void main() { vAlpha = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 color; varying float vAlpha; void main() { gl_FragColor = vec4(color, vAlpha); }',
      transparent: true, depthTest: false, depthWrite: false,
    });
    for (let y = 0; y < world.size; y += TERRAIN_CHUNK) for (let x = 0; x < world.size; x += TERRAIN_CHUNK) {
      const width = Math.min(TERRAIN_CHUNK, world.size - x);
      const depth = Math.min(TERRAIN_CHUNK, world.size - y);
      const geo = new THREE.PlaneGeometry(width * S, depth * S, width, depth).rotateX(-Math.PI / 2);
      const pos = geo.getAttribute('position');
      for (let j = 0; j <= depth; j++) for (let i = 0; i <= width; i++) {
        pos.setXYZ(j * (width + 1) + i, (x + i) * S, world.terrain.heights[(y + j) * (world.size + 1) + x + i] * S + 0.03, (y + j) * S);
      }
      const alpha = new THREE.BufferAttribute(new Float32Array((width + 1) * (depth + 1)), 1);
      geo.setAttribute('alpha', alpha);
      geo.computeBoundingSphere();
      const chunk = new THREE.Mesh(geo, material);
      chunk.renderOrder = 900;
      this.mesh.add(chunk);
      this.chunks.push({ x, y, width, depth, alpha });
    }
    this.update(world);
  }

  update(world: World): void {
    const n = world.size;
    const visible = new Set(world.player.visible);
    for (const chunk of this.chunks) {
      for (let j = 0; j <= chunk.depth; j++) for (let i = 0; i <= chunk.width; i++) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
          const x = chunk.x + i + dx;
          const y = chunk.y + j + dy;
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const index = y * n + x;
          sum += visible.has(index) ? 0 : world.player.explored[index] ? TERRAIN.fog.dimAlpha : TERRAIN.fog.darkAlpha;
          count++;
        }
        chunk.alpha.setX(j * (chunk.width + 1) + i, sum / count);
      }
      chunk.alpha.needsUpdate = true;
    }
  }
}
