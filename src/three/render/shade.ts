// Darkens shaded, explored ground near the player. Uses the same inShade the sim reads for heat, so the
// paint never disagrees with the drain. The sun moves every turn, so the layer recomputes every turn.
// It is a small patch of REACH tiles around the player that moves with the truck, so its cost does not
// grow with the map.
import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { TIME } from '../../data/time';
import { PAL } from '../../render/palette';
import { playerVehicle } from '../../sim/damage';
import { inShade, sunAt } from '../../sim/sun';
import { heightAt } from '../../sim/terrain';
import type { World } from '../../sim/types';

const S = PHYSICS.metersPerTile;
const LIFT = 0.04; // meters above the terrain surface, avoids z-fighting
const REACH = 20; // tiles from the player to the patch edge, the base sight radius
const SIDE = REACH * 2 + 1; // corners along one side of the patch

export class ShadeView {
  readonly mesh: THREE.Mesh;
  private lastTurn = -1;

  constructor(world: World) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SIDE * SIDE * 3), 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(SIDE * SIDE), 1));
    geo.setIndex(patchIndices());
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
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 901; // above ground, obstacles, zones and path; below HTML labels
    this.update(world);
  }

  update(world: World): void {
    if (world.turn === this.lastTurn) return;
    this.lastTurn = world.turn;
    const me = playerVehicle(world).pos;
    const sun = sunAt(world.turn);
    const x0 = Math.floor(me.x) - REACH;
    const y0 = Math.floor(me.y) - REACH;
    const pos = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const alpha = this.mesh.geometry.getAttribute('alpha') as THREE.BufferAttribute;
    for (let j = 0; j < SIDE; j++) {
      for (let i = 0; i < SIDE; i++) {
        const k = j * SIDE + i;
        const x = Math.min(world.size, Math.max(0, x0 + i));
        const y = Math.min(world.size, Math.max(0, y0 + j));
        pos.setXYZ(k, x * S, heightAt(world.terrain, x, y) * S + LIFT, y * S);
        const near = Math.hypot(x - me.x, y - me.y) <= REACH;
        alpha.setX(k, near && sun && cornerExplored(world, x, y) && inShade(world, { x, y }, sun) ? TIME.shadeAlpha : 0);
      }
    }
    pos.needsUpdate = true;
    alpha.needsUpdate = true;
  }
}

function patchIndices(): THREE.BufferAttribute {
  const out: number[] = [];
  for (let j = 0; j < SIDE - 1; j++) {
    for (let i = 0; i < SIDE - 1; i++) {
      const a = j * SIDE + i;
      out.push(a, a + SIDE, a + 1, a + 1, a + SIDE, a + SIDE + 1);
    }
  }
  return new THREE.BufferAttribute(new Uint32Array(out), 1);
}

// A corner reads as explored if any of its up to four surrounding tiles is, matching the fog.
function cornerExplored(world: World, i: number, j: number): boolean {
  const n = world.size;
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
