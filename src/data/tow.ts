// Towing a stranded player to town. See src/sim/tow.ts.

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
