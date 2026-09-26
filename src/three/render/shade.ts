// Darkens shaded, explored ground near the player. Uses the same inShade the sim reads for heat, so the
// paint never disagrees with the drain. The sun moves every turn, so the layer recomputes every turn, and
// only within REACH tiles of the player to keep that cheap. A full map pass takes about a third of a second.
import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { TIME } from '../../data/time';
import { terrainIndices } from '../../phys/drive';
import { PAL } from '../../render/palette';
import { playerVehicle } from '../../sim/damage';
import { inShade, sunAt } from '../../sim/sun';
import type { World } from '../../sim/types';

const S = PHYSICS.metersPerTile;
const LIFT = 0.04; // meters above the terrain surface, above the fog layer's lift
const REACH = 20; // tiles around the player where shade is shown, twice the base sight radius

export class ShadeView {
  readonly mesh: THREE.Mesh;
  private readonly n: number;
  private lastTurn = -1;

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
    const c = new THREE.Color(PAL.shadow);
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
    this.mesh.renderOrder = 901; // above the fog layer, below HTML labels
    this.update(world);
  }

  update(world: World): void {
    if (world.turn === this.lastTurn) return;
    this.lastTurn = world.turn;
    const n = this.n;
    const sun = sunAt(world.turn);
    const me = playerVehicle(world).pos;
    const alpha = this.mesh.geometry.getAttribute('alpha') as THREE.BufferAttribute;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const idx = j * (n + 1) + i;
        const near = Math.hypot(i - me.x, j - me.y) <= REACH;
        alpha.setX(idx, near && sun && cornerExplored(world, n, i, j) && inShade(world, { x: i, y: j }, sun) ? TIME.shadeAlpha : 0);
      }
    }
    alpha.needsUpdate = true;
  }
}

// A corner reads as explored if any of its up to four surrounding tiles is, matching the fog layer.
function cornerExplored(world: World, n: number, i: number, j: number): boolean {
  for (const [x, y] of [
    [i - 1, j - 1],
    [i, j - 1],
    [i - 1, j],
    [i, j],
  ]) {
    if (x < 0 || y < 0 || x >= n || y >= n) continue;
    if (world.player.explored[y * n + x]) return true;
  }
  return false;
}
