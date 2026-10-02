// The worn mesh look shared by truck parts and hulks: each vertex jags by an offset seeded by an id.

import * as THREE from 'three';
import { jagOffset } from '../../render/partLooks';

// A flat model has no thickness, so its jag measures from this extent instead.
const THINNEST_FLOOR = 0.01;

// Moves each vertex by an offset seeded by the part id and its position in the model's own space, so it ignores how the
// model is placed. Corners that share a position move together, so faces stay closed.
export function jag(obj: THREE.Object3D, partId: string, step: number): void {
  obj.updateMatrixWorld(true);
  const toModel = obj.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geo = o.geometry as THREE.BufferGeometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    box.union((geo.boundingBox as THREE.Box3).clone().applyMatrix4(o.matrixWorld).applyMatrix4(toModel));
  });
  const size = box.getSize(new THREE.Vector3());
  const thinnest = Math.max(THINNEST_FLOOR, Math.min(size.x, size.y, size.z));
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geo = o.geometry as THREE.BufferGeometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const toMesh = toModel.clone().multiply(o.matrixWorld).invert();
    const p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(toModel);
      const d = jagOffset(partId, p.x, p.y, p.z, step, thinnest);
      p.add(new THREE.Vector3(d.x, d.y, d.z)).applyMatrix4(toMesh);
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
    if (geo.getAttribute('normal')) geo.computeVertexNormals();
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
  });
}
