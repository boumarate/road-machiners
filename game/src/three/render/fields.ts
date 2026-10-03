// Ground fields from world.fields: a caltrop field draws as steel spikes scattered over its circle, an oil patch as a
// dark decal on the ground. Each has a ring at its edge, so the edge reads where wheels start to suffer. Shown:
// fields the player sees any part of, and the player's own. Render only: it reads world.fields and never changes it.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { hash2 } from '../../render/noise';
import { heightAt, type Terrain } from '../../sim/terrain';
import type { GroundField, World } from '../../sim/types';
import { hashId, isShown } from './smoke';
import { GroundBand } from './zones';

const S = PHYSICS.metersPerTile;
const RENDER_ORDER = 903; // above the fog (900), below dust (904) and smoke (905)
const LOOK = {
  spikesPerArea: 4, // spikes per square tile of field, on top of baseSpikes
  baseSpikes: 6,
  spike: { radius: 0.07, height: 0.14 }, // tiles
  sheen: 0.85, // opacity of the oil decal
  edge: { width: 0.1, opacity: 0.8 }, // the ring at the radius, in tiles
};

type View = { spikes: THREE.Group | null; fill: GroundBand | null; edge: GroundBand };

export class GroundFieldsView {
  readonly root = new THREE.Group();
  private readonly views = new Map<string, View>();
  private readonly spikeGeometry = new THREE.ConeGeometry(LOOK.spike.radius * S, LOOK.spike.height * S, 4);
  private readonly spikeMaterial = new THREE.MeshLambertMaterial({ color: PAL.caltrops.spike, flatShading: true });

  update(world: World, terrain: Terrain): void {
    const shown = new Map(world.fields.filter((f) => isShown(world, f)).map((f) => [f.id, f]));
    for (const [id, view] of this.views) if (!shown.has(id)) this.drop(id, view);
    for (const f of shown.values()) if (!this.views.has(f.id)) this.views.set(f.id, this.makeView(terrain, f));
  }

  private drop(id: string, view: View): void {
    for (const band of [view.fill, view.edge]) {
      if (!band) continue;
      this.root.remove(band.mesh);
      band.dispose();
    }
    if (view.spikes) this.root.remove(view.spikes);
    this.views.delete(id);
  }

  // A field sits still, so its look is built once.
  private makeView(terrain: Terrain, f: GroundField): View {
    const oil = f.kind === 'oil';
    const edge = new GroundBand({ color: oil ? PAL.oil.edge : PAL.caltrops.edge, opacity: LOOK.edge.opacity, renderOrder: RENDER_ORDER + 1, overTrucks: false });
    edge.set(terrain, f.pos, f.r - LOOK.edge.width, f.r);
    this.root.add(edge.mesh);
    if (oil) {
      const fill = new GroundBand({ color: PAL.oil.sheen, opacity: LOOK.sheen, renderOrder: RENDER_ORDER, overTrucks: false });
      fill.set(terrain, f.pos, 0, f.r - LOOK.edge.width);
      this.root.add(fill.mesh);
      return { spikes: null, fill, edge };
    }
    const spikes = this.scatter(terrain, f);
    this.root.add(spikes);
    return { spikes, fill: null, edge };
  }

  // Spikes spread evenly over the disk, each at its own lean, standing on the ground.
  private scatter(terrain: Terrain, f: GroundField): THREE.Group {
    const group = new THREE.Group();
    const seed = hashId(f.id);
    const count = Math.round(LOOK.baseSpikes + LOOK.spikesPerArea * Math.PI * f.r * f.r);
    for (let i = 0; i < count; i++) {
      const k = seed + i * 17;
      const r = Math.sqrt(hash2(k, 3)) * (f.r - LOOK.edge.width);
      const a = hash2(k, 5) * 2 * Math.PI;
      const x = f.pos.x + Math.cos(a) * r;
      const y = f.pos.y + Math.sin(a) * r;
      const spike = new THREE.Mesh(this.spikeGeometry, this.spikeMaterial);
      spike.position.set(x * S, heightAt(terrain, x, y) * S + (LOOK.spike.height * S) / 2, y * S);
      spike.rotation.set((hash2(k, 7) - 0.5) * 0.8, hash2(k, 11) * Math.PI, (hash2(k, 13) - 0.5) * 0.8);
      group.add(spike);
    }
    return group;
  }
}
