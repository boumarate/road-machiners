import { describe, expect, it } from 'vitest';
import { Box3, InstancedMesh, Matrix4, Mesh, Vector3, type Object3D } from 'three';
import { loadModels } from './models';
import { buildSites } from './sites';
import { PHYSICS } from '../../data/physics';
import { REGION } from '../../data/region';
import { insideCurtain } from '../../mapgen/fortress';
import { isFortress, siteGates } from '../../sim/sites';

// The model files as base64 data URLs, since tests run without a server.
const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?inline', import: 'default', eager: true });
await loadModels(async (name) => {
  const url = FILES[`/public/models/${name}.glb`];
  if (!url) throw new Error(`Missing model file for ${name}`);
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
});
const sites = buildSites({ size: 1, heights: [0, 0, 0, 0], types: ['hardpan'] });

const ALL = [...REGION.towns, ...REGION.locations.filter((l) => l.kind !== 'territory')];
const ABANDONED = ALL.filter((s) => !isFortress(s));

function measureSite(id: string): Vector3 {
  const site = sites.getObjectByName(`landmark-${id}`);
  if (!site) throw new Error(`Missing site ${id}`);
  return new Box3().setFromObject(site).getSize(new Vector3());
}

// Pieces marked outsideEdge, like Canyon Bridge, lie outside their site on purpose.
function outsideEdge(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (p.userData.outsideEdge) return true;
  return false;
}

describe('landmark scale', () => {
  it('builds inhabited settlements rather than truck-sized props', () => {
    for (const id of ['bowl', 'nose']) {
      const size = measureSite(id);
      expect(size.x).toBeGreaterThan(100);
      expect(size.z).toBeGreaterThan(100);
      expect(sites.getObjectByName(`landmark-${id}`)!.userData.homes).toBeGreaterThan(15);
    }
  });

  it('draws no edge for a fortress site, whose curtain is baked (IV7)', () => {
    for (const site of ALL.filter(isFortress)) {
      const group = sites.getObjectByName(`landmark-${site.id}`)!;
      expect(group.userData.wallSections, site.id).toBeUndefined();
      expect(group.userData.gates, site.id).toBeUndefined();
    }
  });

  it('keeps the edge of every abandoned site', () => {
    expect(ABANDONED.length).toBeGreaterThan(0);
    for (const site of ABANDONED) expect(sites.getObjectByName(`landmark-${site.id}`)!.userData.wallSections, site.id).toBeGreaterThan(0);
  });

  it('closes every abandoned site with shut doors at each gate', () => {
    for (const site of ABANDONED) {
      const group = sites.getObjectByName(`landmark-${site.id}`)!;
      expect(group.userData.wallSections, site.id).toBeGreaterThan(5);
      expect(group.userData.gates, site.id).toBe(siteGates(site).length);
      expect(group.userData.doors, site.id).toBe(2 * siteGates(site).length);
    }
  });

  it('draws each abandoned edge on the collision edge, at most 1.5 tiles thick', () => {
    for (const site of ABANDONED) {
      const group = sites.getObjectByName(`landmark-${site.id}`)!;
      const reach = group.userData.edgeReach as [number, number];
      expect(reach[0], site.id).toBeGreaterThan(site.radius - 1.5);
      expect(reach[1], site.id).toBeLessThanOrEqual(site.radius + 0.01);
    }
  });

  it('keeps every vertex of a fortress interior inside its curtain, inset by half a wall depth (IV8)', () => {
    const v = new Vector3();
    const m = new Matrix4();
    for (const site of ALL.filter(isFortress)) {
      const bad: string[] = [];
      sites.getObjectByName(`landmark-${site.id}`)!.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        o.updateWorldMatrix(true, false);
        const pos = o.geometry.getAttribute('position');
        const copies = o instanceof InstancedMesh ? o.count : 1;
        for (let k = 0; k < copies; k++) {
          const at = o.matrixWorld.clone();
          if (o instanceof InstancedMesh) at.multiply(o.getMatrixAt(k, m));
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(at);
            if (!insideCurtain(site, { x: v.x / PHYSICS.metersPerTile, y: v.z / PHYSICS.metersPerTile })) {
              bad.push(`${o.name || o.geometry.type} at ${(v.x / PHYSICS.metersPerTile - site.pos.x).toFixed(1)},${(v.z / PHYSICS.metersPerTile - site.pos.y).toFixed(1)}`);
              return;
            }
          }
        }
      });
      expect(bad.slice(0, 5), `${site.id}: ${bad.length} outside`).toEqual([]);
    }
  });

  it('keeps everything a truck could touch inside the edge of an abandoned site', () => {
    const S = PHYSICS.metersPerTile;
    const reach = 1; // tiles above the ground a truck body reaches
    const v = new Vector3();
    const m = new Matrix4();
    for (const site of ABANDONED) {
      let worst = 0;
      sites.getObjectByName(`landmark-${site.id}`)!.traverse((o) => {
        if (!(o instanceof Mesh) || outsideEdge(o)) return;
        o.updateWorldMatrix(true, false);
        const pos = o.geometry.getAttribute('position');
        const copies = o instanceof InstancedMesh ? o.count : 1;
        for (let k = 0; k < copies; k++) {
          const at = o.matrixWorld.clone();
          if (o instanceof InstancedMesh) at.multiply(o.getMatrixAt(k, m));
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(at);
            if (v.y > reach * S) continue;
            worst = Math.max(worst, Math.hypot(v.x / S - site.pos.x, v.z / S - site.pos.y) - site.radius);
          }
        }
      });
      expect.soft(worst, site.id).toBeLessThanOrEqual(0.05);
    }
  });
});
