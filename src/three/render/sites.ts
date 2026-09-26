// Ground-level town and location decoration: pads, ship wreckage, palms, and landmarks.
// Buildings that block movement are obstacles already (see obstacles.ts), so nothing here blocks.

import * as THREE from 'three';
import { REGION, type LocationDef, type TownDef } from '../../data/region';
import { PHYSICS } from '../../data/physics';
import { PAL, shade } from '../../render/palette';
import { heightAt, type Terrain } from '../../sim/terrain';

const S = PHYSICS.metersPerTile;
const PAD_LIFT = 0.03 * S; // keeps the pad from z-fighting the terrain
const TOWER_HEIGHT = 9 * S / 4; // roughly matches the 2D water tower's screen height at this map scale

export function buildSites(t: Terrain): THREE.Group {
  const group = new THREE.Group();
  for (const town of REGION.towns) group.add(buildTown(t, town));
  for (const loc of REGION.locations) group.add(loc.kind === 'oasis' ? buildOasis(t, loc) : loc.kind === 'convoy' ? buildConvoy(t, loc) : buildLandmark(t, loc));
  return group;
}

function groundAt(t: Terrain, x: number, y: number): number {
  return heightAt(t, x, y) * S;
}

function buildTown(t: Terrain, town: TownDef): THREE.Group {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(town.radius * S * 1.15, 24).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: PAL.wall.side }),
  );
  pad.position.set(town.pos.x * S, groundAt(t, town.pos.x, town.pos.y) + PAD_LIFT, town.pos.y * S);
  pad.receiveShadow = true;
  g.add(pad, buildWaterTower(t, { x: town.pos.x - town.radius * 0.4, y: town.pos.y + town.radius * 0.3 }));
  if (town.id === 'nose') {
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(1.1 * S, 3 * S, 4).rotateZ(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: PAL.metalLight, flatShading: true }),
    );
    nose.position.set(town.pos.x * S, groundAt(t, town.pos.x, town.pos.y) + 0.9 * S, town.pos.y * S);
    nose.castShadow = true;
    g.add(nose);
  }
  return g;
}

function buildWaterTower(t: Terrain, pos: { x: number; y: number }): THREE.Group {
  const g = new THREE.Group();
  g.position.set(pos.x * S, groundAt(t, pos.x, pos.y), pos.y * S);
  const legMat = new THREE.MeshLambertMaterial({ color: PAL.metal });
  const legGeo = new THREE.CylinderGeometry(0.06 * S, 0.06 * S, TOWER_HEIGHT, 6);
  for (const [dx, dz] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(dx * S * 0.3, TOWER_HEIGHT / 2, dz * S * 0.3);
    leg.castShadow = true;
    g.add(leg);
  }
  const tank = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5 * S, 0.5 * S, 0.5 * S, 12),
    new THREE.MeshLambertMaterial({ color: PAL.metalLight, flatShading: true }),
  );
  tank.position.y = TOWER_HEIGHT + 0.25 * S;
  tank.castShadow = true;
  g.add(tank);
  return g;
}

function buildOasis(t: Terrain, loc: LocationDef): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + 0.4;
    const x = loc.pos.x + Math.cos(a) * loc.radius * 0.8;
    const y = loc.pos.y + Math.sin(a) * loc.radius * 0.8;
    g.add(buildPalm(t, { x, y }, i));
  }
  return g;
}

function buildPalm(t: Terrain, pos: { x: number; y: number }, i: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(pos.x * S, groundAt(t, pos.x, pos.y), pos.y * S);
  const trunkHeight = 2.4 * S;
  const lean = (i % 2 === 0 ? 1 : -1) * 0.15;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08 * S, 0.12 * S, trunkHeight, 6),
    new THREE.MeshLambertMaterial({ color: PAL.trunk }),
  );
  trunk.position.y = trunkHeight / 2;
  trunk.rotation.z = lean;
  trunk.castShadow = true;
  g.add(trunk);
  const topY = trunkHeight + Math.sin(lean) * 0.2 * S;
  const frondMat = new THREE.MeshLambertMaterial({ color: PAL.palm, flatShading: true, side: THREE.DoubleSide });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const frond = new THREE.Mesh(new THREE.ConeGeometry(0.12 * S, 1.1 * S, 4, 1, true), frondMat);
    frond.position.set(Math.cos(a) * 0.3 * S + lean * S, topY, Math.sin(a) * 0.3 * S);
    frond.rotation.x = Math.PI / 2 - 0.5;
    frond.rotation.z = a;
    frond.castShadow = true;
    g.add(frond);
  }
  return g;
}

function buildLandmark(t: Terrain, loc: LocationDef): THREE.Group {
  const g = new THREE.Group();
  g.position.set(loc.pos.x * S, groundAt(t, loc.pos.x, loc.pos.y), loc.pos.y * S);
  const metal = new THREE.MeshLambertMaterial({ color: PAL.metal, flatShading: true });
  if (loc.id === 'fallen-sun') {
    const hull = new THREE.Mesh(new THREE.BoxGeometry(6 * S, 1.5 * S, 2.5 * S), metal);
    hull.position.y = 0.9 * S;
    hull.rotation.y = -0.25;
    hull.castShadow = true;
    g.add(hull);
  } else if (loc.id === 'canyon-bridge') {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(8 * S, 0.2 * S, 1.8 * S), metal);
    deck.position.set(-3 * S, 0.2 * S, 3 * S);
    deck.rotation.y = 0.75;
    deck.receiveShadow = true;
    g.add(deck);
  } else if (loc.id === 'orchard') {
    for (let i = -1; i <= 1; i++) {
      const tree = new THREE.Mesh(new THREE.ConeGeometry(0.6 * S, 1.8 * S, 5), new THREE.MeshLambertMaterial({ color: PAL.scrub[0] }));
      tree.position.set(i * S, 0.9 * S, 0.5 * S);
      tree.castShadow = true;
      g.add(tree);
    }
  } else {
    const structure = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55 * S, 0.7 * S, 1.8 * S, loc.id === 'granary' ? 10 : 5),
      metal,
    );
    structure.position.y = 0.9 * S;
    structure.castShadow = true;
    g.add(structure);
  }
  return g;
}

function buildConvoy(t: Terrain, loc: LocationDef): THREE.Group {
  const g = new THREE.Group();
  g.position.set(loc.pos.x * S, groundAt(t, loc.pos.x, loc.pos.y), loc.pos.y * S);
  const crate = new THREE.Mesh(
    new THREE.BoxGeometry(0.4 * S, 0.36 * S, 0.4 * S),
    new THREE.MeshLambertMaterial({ color: shade(PAL.crate, 0.85), flatShading: true }),
  );
  crate.position.y = 0.18 * S;
  crate.rotation.y = 0.3;
  crate.castShadow = true;
  g.add(crate);
  return g;
}
