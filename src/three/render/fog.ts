// Fog of war draped over the terrain surface: dark where never explored, dimmed where explored
// but not visible now, clear where visible now. depthTest is off and renderOrder is high, so it
// darkens vehicles and the plan overlay too, cheaply, without shading each object separately.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { TERRAIN } from '../../data/terrain';
import { terrainIndices } from '../../phys/drive';
import { PAL } from '../../render/palette';
import type { World } from '../../sim/types';

const S = PHYSICS.metersPerTile;
const LIFT = 0.03; // meters above the terrain surface, avoids z-fighting

export class FogView {
  readonly mesh: THREE.Mesh;
  private n: number;

  constructor(world: World) {
    const t = world.terrain;
    const n = t.size;
    this.n = n;
    const pos = new Float32Array((n + 1) * (n + 1) * 3);
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const k = (j * (n + 1) + i) * 3;
        pos.set([i * S, t.heights[j * (n + 1) + i] * S + LIFT, j * S], k);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array((n + 1) * (n + 1)), 1));
    geo.setIndex(new THREE.BufferAttribute(terrainIndices(n), 1));
    const c = new THREE.Color(PAL.bg);
    const mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Vector3(c.r, c.g, c.b) } },
      vertexShader: `
        attribute float alpha;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(color, vAlpha);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 900; // above ground, obstacles, zones and path; below HTML labels
    this.update(world);
  }

  update(world: World): void {
    const n = this.n;
    const visible = new Set(world.player.visible);
    const alpha = this.mesh.geometry.getAttribute('alpha') as THREE.BufferAttribute;
    // Per corner: average the fog alpha of the (up to) four surrounding tiles, so type borders blend.
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        let sum = 0;
        let count = 0;
        for (const [x, y] of [
          [i - 1, j - 1],
          [i, j - 1],
          [i - 1, j],
          [i, j],
        ]) {
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const idx = y * n + x;
          sum += visible.has(idx) ? 0 : world.player.explored[idx] ? TERRAIN.fog.dimAlpha : TERRAIN.fog.darkAlpha;
          count++;
        }
        alpha.setX(j * (n + 1) + i, sum / count);
      }
    }
    alpha.needsUpdate = true;
  }
}
