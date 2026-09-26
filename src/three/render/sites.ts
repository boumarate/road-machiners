// Ground-level town and location decoration: pads, ship wreckage, palms, and landmarks.
// Buildings that block movement are obstacles already (see obstacles.ts), so nothing here blocks.
// Models come from tools/blender/; each script's docstring gives its size.

import * as THREE from "three";
import { REGION, type LocationDef, type TownDef } from "../../data/region";
import { PHYSICS } from "../../data/physics";
import { PAL } from "../../render/palette";
import { heightAt, type Terrain } from "../../sim/terrain";
import { model, type ModelName } from "./models";

const S = PHYSICS.metersPerTile;
const PAD_LIFT = 0.03 * S; // keeps the pad from z-fighting the terrain

const LANDMARKS: Record<string, ModelName> = {
  "fallen-sun": "ship_hull",
  granary: "silo",
  "pump-station": "pump_station",
  "south-lock": "lock_gate",
  "glass-flats": "glass_flats",
};

export function buildSites(t: Terrain): THREE.Group {
  const group = new THREE.Group();
  for (const town of REGION.towns) group.add(buildTown(t, town));
  for (const loc of REGION.locations)
    group.add(
      loc.kind === "oasis"
        ? buildOasis(t, loc)
        : loc.kind === "convoy"
          ? buildConvoy(t, loc)
          : buildLandmark(t, loc),
    );
  return group;
}

// A model standing on the ground at map point (x, y), turned by yaw radians.
function placed(t: Terrain, name: ModelName, x: number, y: number, yaw = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x * S, heightAt(t, x, y) * S, y * S);
  g.rotation.y = yaw;
  g.add(model(name));
  return g;
}

function buildTown(t: Terrain, town: TownDef): THREE.Group {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(town.radius * S * 1.15, 24).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: PAL.wall.side }),
  );
  pad.position.set(
    town.pos.x * S,
    heightAt(t, town.pos.x, town.pos.y) * S + PAD_LIFT,
    town.pos.y * S,
  );
  pad.receiveShadow = true;
  g.add(
    pad,
    placed(t, "water_tower", town.pos.x - town.radius * 0.4, town.pos.y + town.radius * 0.3),
  );
  // Shifted off center so the cone clears the water tower.
  if (town.id === "nose") g.add(placed(t, "ship_nose", town.pos.x + 0.6, town.pos.y - 0.5));
  return g;
}

function buildOasis(t: Terrain, loc: LocationDef): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + 0.4;
    const x = loc.pos.x + Math.cos(a) * loc.radius * 0.8;
    const y = loc.pos.y + Math.sin(a) * loc.radius * 0.8;
    g.add(placed(t, "palm", x, y, a * 2.3)); // the model leans, so yaw varies the lean
  }
  return g;
}

function buildLandmark(t: Terrain, loc: LocationDef): THREE.Group {
  const { x, y } = loc.pos;
  if (loc.id === "canyon-bridge") return placed(t, "bridge", x - 3, y + 3, 0.75);
  if (loc.id === "orchard") {
    const g = new THREE.Group();
    for (let i = -1; i <= 1; i++) g.add(placed(t, "orchard_tree", x + i, y + 0.5, i * 2.1));
    return g;
  }
  const name = LANDMARKS[loc.id];
  if (!name) throw new Error(`No model for landmark ${loc.id}`);
  return placed(t, name, x, y, loc.id === "fallen-sun" ? -0.25 : 0);
}

function buildConvoy(t: Terrain, loc: LocationDef): THREE.Group {
  return placed(t, "crates", loc.pos.x, loc.pos.y, 0.3);
}
