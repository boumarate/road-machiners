// Distance culling for static objects. Objects are bucketed into terrain chunks. Each frame the chunks
// whose bounds meet both the camera view and gray vision stay attached to the root. The rest are
// detached, so scene traversal, matrix updates and the renderer skip them. Every object is also clipped
// at the gray vision edge.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import type { Vec } from '../../sim/vec';
import type { V3 } from '../../phys/frames';
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
  constructor(private readonly root: THREE.Object3D, private readonly mapSize: number, private readonly limit: SightLimit) {
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
    this.limit.clip(obj);
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
      const show = this.shows(chunk);
      if (show === chunk.shown) continue;
      if (show) this.root.add(chunk.group);
      else this.root.remove(chunk.group);
      chunk.shown = show;
    }
  }

  private shows(chunk: Chunk): boolean {
    return this.limit.meets(chunk.box, MARGIN) && this.frustum.intersectsBox(this.test.copy(chunk.box).expandByScalar(MARGIN));
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

// The edge of gray vision. Ground and props farther than the gray radius from the player's truck are not
// drawn: their shaders discard every fragment beyond it, so the background shows. Culling uses the same
// circle, so chunks wholly beyond it skip rendering. Shadow casting is not clipped, so a hidden prop just past
// the edge can still shade ground inside it.
type Clipped = THREE.Material & { onBeforeCompile: THREE.Material['onBeforeCompile'] };

export class SightLimit {
  private readonly uniforms = {
    sightCenter: { value: new THREE.Vector2() },
    sightRadius: { value: Number.POSITIVE_INFINITY },
  };
  private readonly clipped = new WeakSet<THREE.Material>();

  // center is the truck's point in 3D meters. radius is in meters.
  set(center: V3, radius: number): void {
    if (!(radius > 0 && Number.isFinite(radius))) throw new Error(`Sight limit radius must be a finite positive number, got ${radius}`);
    this.uniforms.sightCenter.value.set(center.x, center.z);
    this.uniforms.sightRadius.value = radius;
  }

  center(): V3 {
    const c = this.uniforms.sightCenter.value;
    return { x: c.x, y: 0, z: c.y };
  }

  radius(): number {
    return this.uniforms.sightRadius.value;
  }

  // Whether a 3D point lies inside the edge, on the ground plane.
  covers(p: V3): boolean {
    const c = this.uniforms.sightCenter.value;
    return Math.hypot(p.x - c.x, p.z - c.y) <= this.uniforms.sightRadius.value;
  }

  // Whether a world box comes within margin meters of the edge, on the ground plane.
  meets(box: THREE.Box3, margin: number): boolean {
    const c = this.uniforms.sightCenter.value;
    const dx = Math.max(box.min.x - c.x, 0, c.x - box.max.x);
    const dz = Math.max(box.min.z - c.y, 0, c.y - box.max.z);
    return Math.hypot(dx, dz) <= this.uniforms.sightRadius.value + margin;
  }

  // Patches every material under obj once. Chains any shader patch the material already has.
  clip(obj: THREE.Object3D): void {
    obj.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const materials: THREE.Material[] = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of materials) this.clipMaterial(m);
    });
  }

  private clipMaterial(mat: Clipped): void {
    if (this.clipped.has(mat)) return;
    this.clipped.add(mat);
    const before = mat.onBeforeCompile.bind(mat);
    const key = mat.customProgramCacheKey.bind(mat);
    mat.onBeforeCompile = (shader, renderer) => {
      before(shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = inject(shader.vertexShader, '#include <common>', 'varying vec2 vSightXZ;');
      shader.vertexShader = inject(
        shader.vertexShader,
        '#include <project_vertex>',
        `vec4 sightWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        sightWorld = instanceMatrix * sightWorld;
        #endif
        vSightXZ = (modelMatrix * sightWorld).xz;`,
      );
      shader.fragmentShader = inject(shader.fragmentShader, '#include <common>', 'varying vec2 vSightXZ;\nuniform vec2 sightCenter;\nuniform float sightRadius;');
      shader.fragmentShader = inject(shader.fragmentShader, '#include <clipping_planes_fragment>', 'if (distance(vSightXZ, sightCenter) > sightRadius) discard;');
    };
    // Programs are cached by this key. Without the tag, clipped and unclipped materials with the same
    // hook source would share one program.
    mat.customProgramCacheKey = () => `${key()}|sight`;
    mat.needsUpdate = true;
  }
}

// Adds code after a shader chunk include. A missing chunk means an unsupported material, so it stops the build.
function inject(source: string, chunk: string, code: string): string {
  if (!source.includes(chunk)) throw new Error(`Sight limit cannot patch a shader without ${chunk}`);
  return source.replace(chunk, `${chunk}\n${code}`);
}
