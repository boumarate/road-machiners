// Towing a stranded player to town, and the emergency beacon that calls for it. See src/sim/tow.ts.

import { DETECT } from './detect';

export const TOW = {
  // Money for any tow, however short, so a tow from the town gate still costs something.
  base: 40,
  // Money per tile of route to the town gate. A tow from the middle of the Bowl to Nose road is about 240 tiles
  // and costs about 400. That is near the profit of one trade run: 12 electronics bought in Bowl and sold in Nose
  // earn about 48 each.
  perTile: 1.5,
  // Tiles between the tower's center and the towed truck's center. Two tiles is 8 m, about one and a half truck
  // lengths, and more than the two largest chassis radii together, so the two trucks never overlap on a straight.
  gap: 2,
  // Share of its top speed the tower drives at. It drives with care, so the towed truck does not swing out.
  speedShare: 0.6,
};

export const BEACON = {
  // Tiles the beacon reaches, through hills. The map is 600 tiles across. The nearest trader or scavenger to a
  // stranded truck on the main roads was 75 to 170 tiles away over 600 turns. 250 tiles covers that with margin
  // for a helper on the far side of its route, yet stays under half the map, so one call never draws everyone.
  range: 250,
  // Contact circle radius in tiles: the smallest circle any contact has. The beacon names the truck, so every
  // listener trusts it at any distance, and a driver that reaches the circle is close enough to see the truck.
  radius: DETECT.fuzz.base,
};
