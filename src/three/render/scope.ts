// Distance culling for static objects. Objects are bucketed into terrain chunks. Each frame the chunks
// whose bounds meet the camera view stay attached to the root. The rest are detached, so scene
// traversal, matrix updates and the renderer skip them.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import type { Vec } from '../../sim/vec';
import { TERRAIN_CHUNK } from './terrain';

const S = PHYSICS.metersPerTile;
// Meters added around each chunk's bounds, so shadows cast into view from outside it still draw.
// The sun sits 120 m up and 100 m to the side. Models up to 38 m high, like the Nose hull, cast
// shadows under 32 m long. The 71 m Fallen Sun hull casts about 59 m, but its 176 m site radius plus
// this margin still covers the shadow.
const MARGIN = 8 * S;
const IDENTITY = new THREE.Matrix4();

type Chunk = { group: THREE.Group; box: THREE.Box3; shown: boolean };

export class RenderScope {
  private readonly perSide: number;
  private readonly chunks: (Chunk | null)[];
  private readonly owner = new Map<THREE.Object3D, Chunk>();
  private readonly frustum = new THREE.Frustum();
  private readonly viewProjection = new THREE.Matrix4();
  private readonly test = new THREE.Box3();

  // The root must stay at the world origin: chunk bounds are world boxes.
  constructor(private readonly root: THREE.Object3D, private readonly mapSize: number) {
    this.perSide = Math.ceil(mapSize / TERRAIN_CHUNK);
    this.chunks = new Array<Chunk | null>(this.perSide * this.perSide).fill(null);
  }

  // pos is the object's map point in tiles. radius in tiles covers its footprint around pos. The
  // object's own geometry bounds are added too, so a radius that is too small never hides it.
  add(obj: THREE.Object3D, pos: Vec, radius: number): void {
    if (this.owner.has(obj)) throw new Error(`Object ${obj.name || obj.id} is already in the render scope`);
    if (!(pos.x >= 0 && pos.y >= 0 && pos.x <= this.mapSize && pos.y <= this.mapSize)) throw new Error(`Render scope object at ${pos.x},${pos.y} is outside the ${this.mapSize}-tile map`);
    if (!(radius >= 0 && Number.isFinite(radius))) throw new Error(`Render scope radius must be a finite non-negative number, got ${radius}`);
    const chunk = this.chunkAt(pos);
    const bounds = new THREE.Box3().setFromObject(obj);
    const low = bounds.isEmpty() ? obj.position.y : bounds.min.y;
    const high = bounds.isEmpty() ? obj.position.y : bounds.max.y;
    bounds.expandByPoint(new THREE.Vector3((pos.x - radius) * S, low, (pos.y - radius) * S));
    bounds.expandByPoint(new THREE.Vector3((pos.x + radius) * S, high, (pos.y + radius) * S));
    chunk.box.union(bounds);
    chunk.group.add(obj);
    this.owner.set(obj, chunk);
  }

  // The chunk keeps its bounds, which stay a safe superset.
  remove(obj: THREE.Object3D): void {
    const chunk = this.owner.get(obj);
    if (!chunk) throw new Error(`Object ${obj.name || obj.id} is not in the render scope`);
    chunk.group.remove(obj);
    this.owner.delete(obj);
  }

  update(camera: THREE.OrthographicCamera): void {
    this.root.updateWorldMatrix(true, false);
    if (!this.root.matrixWorld.equals(IDENTITY)) throw new Error('Render scope root moved away from the world origin');
    camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    for (const chunk of this.chunks) {
      if (!chunk) continue;
      const show = this.frustum.intersectsBox(this.test.copy(chunk.box).expandByScalar(MARGIN));
      if (show === chunk.shown) continue;
      if (show) this.root.add(chunk.group);
      else this.root.remove(chunk.group);
      chunk.shown = show;
    }
  }

  private chunkAt(pos: Vec): Chunk {
    const cx = Math.min(Math.floor(pos.x / TERRAIN_CHUNK), this.perSide - 1);
    const cy = Math.min(Math.floor(pos.y / TERRAIN_CHUNK), this.perSide - 1);
    const index = cy * this.perSide + cx;
    let chunk = this.chunks[index];
    if (!chunk) {
      const group = new THREE.Group();
      group.name = `scope-chunk-${cx}-${cy}`;
      group.matrixAutoUpdate = false;
      chunk = { group, box: new THREE.Box3(), shown: true };
      this.chunks[index] = chunk;
      this.root.add(group);
    }
    return chunk;
  }
}
