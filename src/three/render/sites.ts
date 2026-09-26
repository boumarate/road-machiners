import * as THREE from 'three';
import { REGION, type LocationDef, type TownDef } from '../../data/region';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { hash2 } from '../../render/noise';
import { heightAt, type Terrain } from '../../sim/terrain';
import { segmentDist } from '../../sim/vec';
import type { RenderScope } from './scope';

const S = PHYSICS.metersPerTile;
type Site = TownDef | LocationDef;

// Site props stay within the site's collision footprint. Every prop is grounded independently.
class SiteBuilder {
  readonly root = new THREE.Group();
  private readonly materials = new Map<number, THREE.MeshLambertMaterial>();
  constructor(private readonly terrain: Terrain, private readonly site: Site) {
    this.root.name = `landmark-${site.id}`;
  }
  addShape(geometry: THREE.BufferGeometry, color: number, x: number, z: number, lift: number, yaw = 0): THREE.Mesh {
    let material = this.materials.get(color);
    if (!material) {
      material = new THREE.MeshLambertMaterial({ color, flatShading: true });
      this.materials.set(color, material);
    }
    const mesh = new THREE.Mesh(geometry, material);
    const wx = this.site.pos.x + x;
    const wz = this.site.pos.y + z;
    mesh.position.set(wx * S, (heightAt(this.terrain, wx, wz) + lift) * S, wz * S);
    mesh.rotation.y = yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    return mesh;
  }
  addBox(x: number, z: number, w: number, h: number, d: number, color: number, lift = 0, yaw = 0): THREE.Mesh {
    return this.addShape(new THREE.BoxGeometry(w * S, h * S, d * S), color, x, z, lift + h / 2, yaw);
  }
  addTank(x: number, z: number, radius: number, height: number, color: number, lift = 0): void {
    this.addShape(new THREE.CylinderGeometry(radius * S, radius * S, height * S, 10), color, x, z, lift + height / 2);
  }
  addTree(x: number, z: number, index: number, alive: boolean): void {
    const lean = (hash2(index, 19) - 0.5) * 0.35;
    const trunk = this.addBox(x, z, 0.16, 1.5, 0.18, PAL.trunk);
    trunk.rotation.z = lean;
    for (const sign of [-1, 1]) {
      const branch = this.addBox(x + sign * 0.24, z, 0.1, 0.95, 0.12, PAL.trunk, 0.85);
      branch.rotation.z = sign * 0.75;
    }
    if (alive) {
      this.addShape(new THREE.IcosahedronGeometry(0.65 * S, 0), PAL.scrub[index % PAL.scrub.length], x, z, 1.9);
      this.addShape(new THREE.IcosahedronGeometry(0.4 * S, 0), PAL.palm, x + 0.45, z - 0.15, 1.6);
    } else this.addBox(x + 0.35, z, 0.7, 0.13, 0.18, PAL.trunk, 0.03, lean);
  }
  addRuin(x: number, z: number, width: number, depth: number): void {
    this.addBox(x, z, width, 0.12, depth, PAL.wall.dark);
    this.addBox(x - width / 2, z, 0.2, 1.2, depth, PAL.wall.side);
    this.addBox(x, z - depth / 2, width, 0.85, 0.2, PAL.wall.top);
    this.addBox(x + width / 2, z - depth / 3, 0.2, 0.55, depth / 3, PAL.wall.side);
    this.addBox(x + 0.3, z + 0.3, width * 0.7, 0.12, depth * 0.8, PAL.rust.top, 0.08, 0.35);
  }
  addHull(x: number, z: number, length: number, width: number, yaw: number): void {
    this.addBox(x, z, length, 0.3, width, PAL.metal, 0.1, yaw);
    for (let i = 0; i < 5; i++) {
      const along = (i / 4 - 0.5) * length;
      for (const side of [-1, 1]) {
        const dx = along * Math.cos(yaw) + side * width * 0.42 * Math.sin(yaw);
        const dz = -along * Math.sin(yaw) + side * width * 0.42 * Math.cos(yaw);
        const rib = this.addBox(x + dx, z + dz, 0.16, width * 0.65, 0.18, PAL.metalLight, 0.25, yaw);
        rib.rotation.x = side * 0.25;
      }
    }
    const shell = new THREE.CylinderGeometry(width * 0.5 * S, width * 0.42 * S, length * 0.72 * S, 8, 1, true, 0, Math.PI * 1.55).rotateZ(Math.PI / 2);
    const hull = this.addShape(shell, PAL.metalLight, x, z, width * 0.4, yaw);
    (hull.material as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
    for (const side of [-1, 1]) {
      this.addBox(x, z + side * width * 0.42, length * 0.68, 0.12, 0.2, PAL.rust.top, width * 0.55, yaw);
    }
    for (let i = -1; i <= 1; i++) {
      this.addBox(x + i * length * 0.2, z, 0.2, 0.22, width * 0.7, PAL.metal, width * 0.88, yaw);
      this.addBox(x + i * length * 0.3, z - width * 0.6, length * 0.12, 0.12, width * 0.3, PAL.metalLight, 0.15, yaw + i * 0.4);
    }
  }
}

function buildOrchard(b: SiteBuilder): void {
  const { orchardRows: rows, orchardSpacing: spacing } = REGION.settlement;
  const half = (rows - 1) / 2;
  for (let row = 0; row < rows; row++) {
    const x = (row - half) * spacing;
    b.addBox(x - 0.65, 0, 0.18, 0.06, rows * spacing, PAL.wall.dark);
    for (let col = 0; col < rows; col++) {
      const index = row * rows + col;
      b.addTree(x, (col - half) * spacing, index, index % 4 !== 0);
    }
  }
  b.addRuin(0, 14, 6, 4);
  for (let i = -6; i <= 6; i++) b.addBox(i * 2, -12, 0.12, 0.65, 0.12, PAL.trunk);
  b.addBox(0, -12, 24, 0.1, 0.12, PAL.trunk, 0.4);
}

function buildSettlement(b: SiteBuilder, site: Site): void {
  const layout = REGION.settlement;
  const limit = site.radius - layout.houseWidth - 0.3;
  let homes = 0;
  for (let x = -limit; x <= limit; x += layout.streetSpacing) {
    for (let z = -limit; z <= limit; z += layout.streetSpacing) {
      if (Math.hypot(x, z) > limit) continue;
      if (site.id === 'bowl' ? Math.hypot(x, z) < 9 : Math.abs(x) < 21 && Math.abs(z) < 9) continue;
      const pos = { x: site.pos.x + x, y: site.pos.y + z };
      if (REGION.roads.some((road) => road.some((point, i) => i > 0 && segmentDist(pos, road[i - 1], point) < REGION.roadWidth / 2 + layout.houseWidth))) continue;
      const h = layout.houseHeights[homes % layout.houseHeights.length];
      const w = layout.houseWidth;
      const d = layout.houseDepth;
      b.addBox(x, z, w, h, d, homes % 3 ? PAL.wall.side : PAL.wall.top);
      b.addBox(x, z, w + 0.3, 0.12, d + 0.3, homes % 4 ? PAL.rust.top : PAL.metal, h);
      b.addBox(x, z + d / 2 + 0.02, 0.3, 0.55, 0.03, PAL.wall.dark);
      for (const dx of [-0.8, 0.8]) {
        b.addBox(x + dx, z + d / 2 + 0.02, 0.3, 0.3, 0.03, PAL.wall.dark, 0.55);
        if (h > 1.5) b.addBox(x + dx, z + d / 2 + 0.02, 0.3, 0.3, 0.03, PAL.wall.dark, 1.25);
      }
      if (homes % 5 === 0) b.addTank(x - 0.6, z - 0.4, 0.3, 0.55, PAL.metalLight, h + 0.12);
      homes++;
    }
  }
  b.root.userData.homes = homes;
  if (site.id === 'bowl') {
    b.addTank(0, 0, 6, 0.05, PAL.water);
    for (let row = 0; row < 4; row++) b.addBox(-6 + row * 3, 9, 2, 0.12, 4, PAL.scrub[0]);
  } else {
    b.addHull(-3, -1, 22, 10, 0);
    b.addShape(new THREE.ConeGeometry(5 * S, 12 * S, 8).rotateZ(-Math.PI / 2), PAL.metalLight, 12, -1, 4);
  }
}

function buildGranary(b: SiteBuilder): void {
  for (let x = -3; x <= 3; x += 3) {
    b.addTank(x, -1, 1.1, 3.2, PAL.wall.top);
    b.addShape(new THREE.ConeGeometry(1.2 * S, 0.7 * S, 10), PAL.metal, x, -1, 3.55);
    b.addBox(x, 0.12, 0.65, 1.2, 0.12, PAL.rust.dark);
  }
  b.addRuin(0, 2.8, 6, 2.2);
  for (let i = 0; i < 8; i++) b.addBox(-2.5 + (i % 4) * 0.65, 2 + Math.floor(i / 4) * 0.65, 0.5, 0.45, 0.5, PAL.crate);
}

function buildPump(b: SiteBuilder): void {
  b.addRuin(-1.7, 0, 3, 3.8);
  b.addTank(2.5, -1, 1.1, 2.5, PAL.metalLight);
  for (const z of [-2, 2]) {
    b.addBox(1, z, 5.5, 0.45, 0.45, PAL.metal, 0.35);
    b.addShape(new THREE.TorusGeometry(0.55 * S, 0.09 * S, 5, 10), PAL.rust.top, 1, z, 1.1);
  }
  b.addBox(-2, 0, 1.2, 0.85, 2, PAL.rust.side);
}

function buildLock(b: SiteBuilder): void {
  for (const x of [-2, 2]) b.addBox(x, 0, 0.6, 1.1, 8, PAL.wall.side);
  b.addBox(0, 0, 3.6, 0.05, 8, PAL.water);
  for (const z of [-2, 2]) {
    b.addBox(0, z, 4.5, 0.25, 0.75, PAL.metal, 1.3);
    b.addBox(0, z, 3.2, 1, 0.2, PAL.rust.side, 0.2);
  }
  b.addRuin(3.7, 0, 1.7, 2);
}

function buildBridge(b: SiteBuilder): void {
  // The road approaches the named eastern abutment from the southwest across the canyon.
  for (let i = 0; i < 18; i++) {
    const x = -25 + i;
    const z = 25 - i;
    b.addBox(x, z, Math.SQRT2 + 0.02, 0.08, 2.5, PAL.wall.top, 0, Math.PI / 4);
    for (const side of [-1, 1]) {
      b.addBox(x + side, z + side, Math.SQRT2 + 0.02, 0.12, 0.12, PAL.metal, 0.8, Math.PI / 4);
      if (i % 3 === 0) b.addBox(x + side, z + side, 0.18, 0.9, 0.18, PAL.metal);
    }
  }
  b.addRuin(0, 0, 3, 2);
}

function buildOasis(b: SiteBuilder, well: boolean): void {
  if (well) {
    b.addTank(0, 0, 1.2, 0.8, PAL.wall.side);
    b.addTank(0, 0, 0.9, 0.04, PAL.water, 0.8);
    for (const x of [-1.5, 1.5]) b.addBox(x, 0, 0.18, 2.6, 0.18, PAL.trunk);
    b.addBox(0, 0, 3.3, 0.2, 0.25, PAL.trunk, 2.5);
    b.addRuin(2.7, 2.7, 2.3, 2);
  } else {
    b.addTank(0, 0, 2.8, 0.04, PAL.waterLight);
    for (let i = 0; i < 9; i++) {
      const a = i * Math.PI * 2 / 9;
      b.addTree(Math.cos(a) * 4, Math.sin(a) * 4, i, true);
    }
  }
}

function buildWrecks(b: SiteBuilder, id: string): void {
  if (id === 'salvage-yard') {
    for (const x of [-3, 0, 3]) {
      b.addBox(x, -2, 2.3, 1.2, 2, PAL.rust.side);
      b.addBox(x, -2, 2.6, 0.12, 2.4, PAL.metalLight, 1.3);
      for (let i = 0; i < 3; i++) b.addBox(x, 1 + i * 0.8, 1.5, 0.5, 0.6, i % 2 ? PAL.metal : PAL.rust.top);
    }
    b.addBox(-3, 1, 0.25, 4, 0.25, PAL.metal);
    b.addBox(-1.5, 1, 3.2, 0.22, 0.22, PAL.metal, 3.8);
  } else if (id === 'podfield') {
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4;
      const pod = b.addShape(new THREE.CapsuleGeometry(0.45 * S, 1.1 * S, 2, 6), PAL.metalLight, Math.cos(a) * 3.4, Math.sin(a) * 3.4, 0.65);
      pod.rotation.z = 0.7 + i * 0.3;
    }
  } else {
    b.addHull(-1, 0, id === 'ridge-wrecks' ? 7 : 4, 2, 0.3);
    b.addHull(2, 3, 3.5, 1.5, -0.6);
    for (let i = 0; i < 5; i++) b.addBox(-3 + i, -3, 0.5, 0.25, 1, PAL.rust.dark, 0, i);
  }
}

function buildSite(t: Terrain, site: Site): THREE.Group {
  const b = new SiteBuilder(t, site);
  switch (site.id) {
    case 'orchard': buildOrchard(b); break;
    case 'granary': buildGranary(b); break;
    case 'pump-station': buildPump(b); break;
    case 'south-lock': buildLock(b); break;
    case 'canyon-bridge': buildBridge(b); break;
    case 'dustwell': buildOasis(b, true); break;
    case 'green-pit': buildOasis(b, false); break;
    case 'fallen-sun':
      b.addHull(0, 0, 68, 22, -0.2);
      b.addBox(-10, 16, 25, 0.3, 15, PAL.metalLight, 0.6, 0.3);
      for (const z of [-8, 8]) b.addTank(-33, z, 3, 5, PAL.rust.dark);
      break;
    case 'glass-flats':
      for (let i = 0; i < 25; i++) {
        const x = (hash2(i, 11) - 0.5) * 8;
        const z = (hash2(i, 23) - 0.5) * 8;
        const shard = b.addShape(new THREE.OctahedronGeometry((0.3 + hash2(i, 17) * 0.7) * S, 0), i % 3 ? PAL.water : PAL.metalLight, x, z, 0.25, i);
        shard.scale.y = 0.35;
      }
      break;
    case 'nose': case 'bowl': buildSettlement(b, site); break;
    case 'burnt-convoy': case 'podfield': case 'ridge-wrecks': case 'salvage-yard': buildWrecks(b, site.id); break;
    default: throw new Error(`Missing landmark model for ${site.id}`);
  }
  // Site models never move after they are built.
  b.root.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
  return b.root;
}

// Every site model under one group, for inspection.
export function buildSites(t: Terrain): THREE.Group {
  const group = new THREE.Group();
  for (const site of [...REGION.towns, ...REGION.locations]) group.add(buildSite(t, site));
  return group;
}

// Registers every site model with the scope at its site.
export function addSites(t: Terrain, scope: RenderScope): void {
  for (const site of [...REGION.towns, ...REGION.locations]) scope.add(buildSite(t, site), site.pos, site.radius);
}
