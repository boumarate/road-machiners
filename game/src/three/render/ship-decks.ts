// The Fallen Sun's wing and flaps: a ship_wing_deck plate on each wing deck and a ship_flap on each flap, posed on the
// deck line like Broken Wing's deck, and a skirt strip under each rail and lip down into the ground, mirroring the
// physics skirt (addDeck() in src/phys/drive.ts). src/sim/bridge.ts owns the decks; this view only draws them. The
// strips stand a little inside the deck edge, behind the models' own torn skirt plates and lip beams, so the two never
// share a face.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { FALLEN_SUN_DECKS } from '../../data/territory';
import { hash2 } from '../../render/noise';
import { PAL } from '../../render/palette';
import { deckById, type Deck } from '../../sim/bridge';
import { deckHeight, groundAt, type Terrain } from '../../sim/terrain';
import { dist, type Vec } from '../../sim/vec';
import { poseOnDeck } from './deck-pose';
import { model } from './models';
import type { RenderScope } from './scope';

const S = PHYSICS.metersPerTile;
// The models' reference sizes in meters (tools/blender/ship_wing_deck.py and ship_flap.py): length along the deck,
// width across it between the rail lines, and the flap's rise at its lip.
const WING = { length: 88, width: 32 };
const FLAP = { length: 20, width: 12, rise: 1.4 };
const RAIL_INSET = 0.5; // meters a rail's strip stands inside the rail line, behind the wing's hanging skirt plates
const LIP_INSET = 0.6; // meters a lip's strip stands inside the deck end, behind the flap's lip beam
const TOP_DROP = 0.1; // meters the strip's top lies under the deck line, inside the model's plate
const SKIRT_COLORS = [PAL.hull.grey, PAL.hull.dark, PAL.hull.dark, PAL.hull.rust];

// Every Fallen Sun deck's model and skirt, one group per deck, for inspection.
export function buildShipDecks(t: Terrain): THREE.Group {
  const root = new THREE.Group();
  for (const deck of shipDecks()) root.add(buildShipDeck(t, deck));
  return root;
}

// Registers each Fallen Sun deck's model and skirt with the scope at the deck's middle.
export function addShipDecks(t: Terrain, scope: RenderScope): void {
  for (const deck of shipDecks()) {
    const mid = { x: deck.from.x + (deck.axis.x * deck.length) / 2, y: deck.from.y + (deck.axis.y * deck.length) / 2 };
    scope.add(buildShipDeck(t, deck), mid, Math.hypot(deck.length, deck.width) / 2);
  }
}

function shipDecks(): Deck[] {
  return FALLEN_SUN_DECKS.map((spec) => deckById(spec.id));
}

function buildShipDeck(t: Terrain, deck: Deck): THREE.Group {
  const root = new THREE.Group();
  root.name = `ship-deck-${deck.id}`;
  const plate = deckModel(deck);
  plate.name = 'ship-deck-model';
  poseOnDeck(plate, t, deck, 0);
  root.add(plate, skirt(t, deck));
  root.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
  return root;
}

// The wing plate or the flap, stretched to the deck. Deck ids tell the wing's segments from the flaps.
function deckModel(deck: Deck): THREE.Object3D {
  if (deck.id.includes('-wing-')) {
    const obj = model('ship_wing_deck');
    obj.scale.set((deck.length * S) / WING.length, 1, (deck.width * S) / WING.width);
    return obj;
  }
  if (deck.id.includes('-flap-')) {
    // The flap model has its hinge on the ground at -x and its lip at +x, which poseOnDeck puts at the to end.
    if (deck.rise[0] !== 0 || deck.rise[1] <= 0) throw new Error(`Flap ${deck.id} must rise from 0 at its from end to its lip, not [${deck.rise.join(', ')}]`);
    const obj = model('ship_flap');
    obj.scale.set((deck.length * S) / FLAP.length, (deck.rise[1] * S) / FLAP.rise, (deck.width * S) / FLAP.width);
    return obj;
  }
  throw new Error(`Deck ${deck.id} is neither a wing segment nor a flap`);
}

// A strip from just under the deck line down past the ground, sampled every tile, along each rail of a skirted deck
// and across each lip. It reaches PHYSICS.rockSink under the ground, as the physics skirt does.
function skirt(t: Terrain, deck: Deck): THREE.Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const edges = [...(deck.skirt ? deck.rails.map((rail, i) => ({ line: rail, inward: railInward(deck, i), inset: RAIL_INSET })) : []), ...deck.lips.map((lip) => ({ line: lip, inward: lipInward(deck, lip), inset: LIP_INSET }))];
  edges.forEach(({ line: [a, b], inward, inset }, e) => {
    const steps = Math.max(1, Math.ceil(dist(a, b)));
    const cols = Array.from({ length: steps + 1 }, (_, k) => column(t, deck, { x: a.x + ((b.x - a.x) * k) / steps + (inward.x * inset) / S, y: a.y + ((b.y - a.y) * k) / steps + (inward.y * inset) / S }));
    for (let k = 0; k < steps; k++) {
      const [p, q] = [cols[k], cols[k + 1]];
      positions.push(...p.top, ...p.bottom, ...q.top, ...q.top, ...p.bottom, ...q.bottom);
      const color = new THREE.Color(SKIRT_COLORS[Math.floor(hash2(k + 31 * e, deck.length * 7) * SKIRT_COLORS.length)]);
      for (let v = 0; v < 6; v++) colors.push(color.r, color.g, color.b);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.name = 'ship-deck-skirt';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// A strip column at a map point, in meters: its top under the deck line and its bottom under the ground. Where the
// deck line dips under the ground the column is empty, its bottom at its top.
function column(t: Terrain, deck: Deck, p: Vec): { top: [number, number, number]; bottom: [number, number, number] } {
  const along = Math.min(deck.length, Math.max(0, (p.x - deck.from.x) * deck.axis.x + (p.y - deck.from.y) * deck.axis.y));
  const top = deckHeight(t, deck, along) * S - TOP_DROP;
  const bottom = Math.min(top, groundAt(t, p.x, p.y) * S - PHYSICS.rockSink);
  return { top: [p.x * S, top, p.y * S], bottom: [p.x * S, bottom, p.y * S] };
}

// Rail i lies on side -1 or +1 of the axis turned a quarter toward +y (src/sim/bridge.ts); inward points back across.
function railInward(deck: Deck, i: number): Vec {
  const side = i === 0 ? -1 : 1;
  return { x: deck.axis.y * side, y: -deck.axis.x * side };
}

// A lip lies across the from or the to end; inward points back along the deck.
function lipInward(deck: Deck, [a, b]: [Vec, Vec]): Vec {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const sign = dist(mid, deck.to) < dist(mid, deck.from) ? -1 : 1;
  return { x: deck.axis.x * sign, y: deck.axis.y * sign };
}
