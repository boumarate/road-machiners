// Fog of war draped over the terrain surface: a thick pale haze where never explored, a thin haze where
// explored but not visible now, clear where visible now. Haze, not darkness, so shade stays the only dark ground. depthTest is off and renderOrder is high, so it
// covers vehicles and the plan overlay too, cheaply, without shading each object separately.

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
    const c = new THREE.Color(PAL.haze);
    const rgba = new Float32Array((n + 1) * (n + 1) * 4);
    for (let k = 0; k < rgba.length; k += 4) rgba.set([c.r, c.g, c.b, 0], k);
    geo.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
    geo.setIndex(new THREE.BufferAttribute(terrainIndices(n), 1));
    geo.computeVertexNormals();
    // Lit like the ground, so the haze dims at night with everything else. Per-corner alpha rides in the vertex color.
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 900; // above ground, obstacles, zones and path; below HTML labels
    this.update(world);
  }

  update(world: World): void {
    const n = this.n;
    const visible = new Set(world.player.visible);
    const color = this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
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
          sum += visible.has(idx) ? 0 : world.player.explored[idx] ? TERRAIN.fog.seenAlpha : TERRAIN.fog.unseenAlpha;
          count++;
        }
        color.setW(j * (n + 1) + i, sum / count);
      }
    }
    color.needsUpdate = true;
  }
}
