// Global rule numbers. Tuned by playing.

export const RULES = {
  // Movement
  substeps: 26, // per turn; step length must stay below the smallest collision radius
  crawlSpeed: 1, // below this speed turning slows toward a standstill
  lowFuelThreshold: 0.2, // share of tank remaining when speed is limited
  lowFuelSpeedFactor: 0.5, // share of normal top speed below the threshold
  fuelUseFactor: 0.075, // share of the chassis fuel rate burned per tile; a daytime Bowl to Nose road trip uses under 60% of the starting fuel, leaving room for detours and fights
  npcStuckTurns: 2, // failed drive attempts before backing out
  npcRecoveryTurns: 2, // turns spent backing out before resuming the route
  // At or below `below` speed, a truck more than `angle` degrees off its destination backs up
  // `distance` tiles in a turn, swinging its nose by up to the chassis reverseTurn. It stops after.
  reverse: { below: 1, angle: 45, distance: 1 },
  arriveRadius: 0.5, // a stop order clears inside this distance
  // Throttle zones ahead of the truck. They span `reach` tiles, split into brake, hold and accelerate
  // shares in that order. A click's distance picks the zone.
  throttleZones: { reach: 10, brake: 0.25, hold: 0.5, accelerate: 0.25 },
  reclickRadius: 0.75, // tiles; a click this close to the order's point switches its kind
  passRadius: 1, // a drive-through order clears once the truck passes this close to its point, or drives past it
  minAimDistance: 1.5, // tiles; steering ignores route points closer than this
  cornerSlack: 2, // tiles past a route corner the brake plan allows
  refitTurnsPerPart: 5,
  parkedSpeed: 0.5, // vehicles slower than this are routed around like obstacles
  yieldDistance: 1.5, // tiles neutral drivers keep past both radii from a vehicle ahead, beyond what both close before they stop; see src/sim/ai.ts
  maxBulge: 0.25, // tiles a steering arc may stray from the straight route line
  limpSpeed: 1.04, // 15 km/h, top speed with an empty tank or a dead engine or transmission; a truck this slow raises no dust
  minSpeedCap: 1, // a heavy load never pushes max speed below this
  collisionMinImpact: 1.5, // slower bumps deal no damage
  // A crash gives each truck ramDamage × impact² in tiles per turn × the other body's share of both masses,
  // spread over the lanes of its struck side. An obstacle's share is 1. Squaring the impact, like crash
  // energy, keeps a full-speed crash at 6 as hard as before while a bump at 2 only scratches the paint.
  ramDamage: 2.5,
  cellPen: 0.5, // penetration every grid cell a round or crash passes costs, for the frame and bulk in the way
  crashPen: 4, // penetration of crash damage in each lane
  wheelLoss: 0.15, // share of speed and turning lost per broken wheel
  tankLeak: 1, // fuel lost per turn with a broken tank

  // Town guards. Each town gate has one gun. Every turn it shoots the nearest vehicle within range that fired.
  // Each round hits with a flat chance and enters a random lane of the side facing the gate.
  guards: {
    range: 12,
    rounds: 4,
    hitChance: 0.5,
    missOffset: 1.5,
    round: { damage: 6, pen: 10 },
  },

  // Combat
  // A round that lands on the truck is a crit with this chance. A crit multiplies its damage and pen, so a few
  // lucky rounds can swing a fight that many small rolls would otherwise average out.
  critChance: 0.1,
  critDamage: 2,
  critPen: 2,
  // A round's angular error has a spread in radians: weapon spread × (1 − gunnery), plus
  // leadError × crossing speed / round speed, plus shake × own speed in m/s.
  leadError: 4.5, // share of the lead angle the gunner misjudges
  shake: 0.002, // radians of spread per m/s of the shooter's own speed
  cellMeters: 0.5, // width of one grid cell, for the size of an aimed part
  cabHealthShare: 0.5, // share of cab damage the player's character takes as health loss
  minHit: 0.05,
  maxHit: 0.95,
  killXp: 40,
  wreckRadiusScale: 1, // wreck obstacle radius relative to the vehicle
  maxKillWrecks: 12, // oldest wrecks from kills are cleared past this, so obstacles do not pile up

  // Supplies, per turn
  suppliesPerTurn: 0.015, // at base heat; a full load lasts about 550 daytime turns, enough to explore off the roads
  suppliesCap: 20,
  suppliesLow: 4, // the HUD warns at or below this, about 110 daytime turns before running out
  starveDamage: 5, // character health lost per turn without supplies
  starveFloor: 30, // starving stops here, so only cab damage can kill
  maxHealth: 100,
  healPerTurn: 1, // health a parked player with supplies regains per turn; from the starve floor to full in 70 turns
  healSupplies: 0.01, // supplies spent per turn of healing, on top of the normal drain
  townHealMult: 5, // healing multiplier at a town, where the driver rests in a bed

  // Progress
  xpPerLevel: 100, // level n needs n * xpPerLevel more
  startSkillPoints: 2,
  maxSkillLevel: 5,
  discoverXp: 25,
  tradeXpPerProfit: 0.3, // xp per money unit of profit on a sale

  // Knockout
  defeatPatch: 0.25, // share of max hp broken core parts get back when the player wakes from a knockout
  knockoutMaxTurns: 30, // a knockout ends after this many turns even if a hostile idles in sight
};

// Debug console numbers. Distances are in tiles.
export const CHEATS = {
  spawnDistance: 10, // a spawned vehicle appears this far from the truck, inside sight range
  spawnAngles: 12, // points tried on the spawn circle before the ring search
  searchStep: 1, // spacing between rings and between points on a ring, in the free spot search
  searchRings: 20, // rings searched around a target before giving up
};
