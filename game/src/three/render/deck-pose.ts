// Poses a deck model on its sim deck. Broken Wing, Canyon Bridge and the Fallen Sun's wing and flaps share it, so
// every drawn deck follows the deck line from sim/terrain.ts, which the physics deck also follows.

import type * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import type { Deck } from '../../sim/bridge';
import { deckEnds, type Terrain } from '../../sim/terrain';

const S = PHYSICS.metersPerTile;

// Puts the model's middle on the deck's middle, pitched along the deck line and turned along the deck axis, so its
// +x runs from the deck's from end to its to end. `top` is meters from the model origin up to its deck top, after
// scaling.
export function poseOnDeck(obj: THREE.Object3D, terrain: Terrain, deck: Deck, top: number): void {
  const { from, axis, length } = deck;
  const [h0, h1] = deckEnds(terrain, deck);
  const pitch = Math.atan2((h1 - h0) * S, length * S);
  obj.position.set((from.x + (axis.x * length) / 2) * S, ((h0 + h1) / 2) * S - top, (from.y + (axis.y * length) / 2) * S);
  // YXZ applies the pitch about the model's own z first, then the yaw.
  obj.rotation.set(0, -Math.atan2(axis.y, axis.x), pitch, 'YXZ');
}
