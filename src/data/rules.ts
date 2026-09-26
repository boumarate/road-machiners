// Global rule numbers. Tuned by playing.

export const RULES = {
  // Movement
  substeps: 20, // per turn; step length must stay below the smallest collision radius
  crawlSpeed: 1, // speed used for sharp turns and moving without fuel
  lowFuelThreshold: 0.2, // share of tank remaining when speed is limited
  lowFuelSpeedFactor: 0.5, // share of normal top speed below the threshold
  fuelUseFactor: 0.1, // fuel burns at a tenth of the chassis rate
  npcStuckTurns: 2, // failed drive attempts before backing out
  npcRecoveryTurns: 2, // turns spent backing out before resuming the route
  // At or below `below` speed, a truck more than `angle` degrees off its destination backs up
  // `distance` tiles in a turn, swinging its nose by up to the chassis reverseTurn. It stops after.
  reverse: { below: 1, angle: 45, distance: 1 },
  stopClickSpeed: 1, // above this speed a click in the brake zone brakes to a full stop
  arriveRadius: 0.5, // a stop order clears inside this distance
  // Throttle zones ahead of the truck. They span `reach` of the vision radius, split into brake, hold
  // and accelerate shares in that order. A click's distance picks the zone.
  throttleZones: { reach: 1, brake: 0.25, hold: 0.5, accelerate: 0.25 },
  passRadius: 1, // a drive-through order clears once the trail passes this close to its point
  passSpeedShare: 0.5, // ...or once its point is nearer than this share of the current speed
  minAimDistance: 1.5, // tiles; steering ignores route points closer than this
  cornerSlack: 2, // tiles past a route corner the brake plan allows
  parkedSpeed: 0.5, // vehicles slower than this are routed around like obstacles
  yieldDistance: 1.5, // neutral drivers brake when another vehicle is this close past both radii ahead
  maxBulge: 0.25, // tiles a steering arc may stray from the straight route line
  disabledEngineSpeed: 1,
  minSpeedCap: 1, // a heavy load never pushes max speed below this
  collisionMinImpact: 1.5, // slower bumps deal no damage
  collisionDamage: 4, // part damage per tile/turn of impact speed, scaled by mass ratio, spread over the struck side's lanes
  crashPen: 4, // penetration of crash damage in each lane
  wheelLoss: 0.15, // share of speed and turning lost per broken wheel
  tankLeak: 1, // fuel lost per turn with a broken tank

  // Combat
  rangeFalloff: 0.3, // hit chance lost at max range
  speedEvasion: 0.03, // hit chance lost per tile/turn of target speed
  aimedPenalty: 0.25,
  cabHealthShare: 0.5, // share of cab damage the player's character takes as health loss
  minHit: 0.05,
  maxHit: 0.95,
  killXp: 40,
  wreckRadiusScale: 1, // wreck obstacle radius relative to the vehicle
  maxKillWrecks: 12, // oldest wrecks from kills are cleared past this, so obstacles do not pile up

  // Supplies, per turn
  suppliesPerTurn: 0.025,
  suppliesCap: 20,
  starveDamage: 5, // character health lost per turn without supplies
  maxHealth: 100,

  // Progress
  xpPerLevel: 100, // level n needs n * xpPerLevel more
  startSkillPoints: 2,
  maxSkillLevel: 5,
  discoverXp: 25,
  tradeXpPerProfit: 0.3, // xp per money unit of profit on a sale

  // Defeat
  defeatMoneyLoss: 0.5,
  defeatPatch: 0.25, // share of max hp broken core parts and the engine get back after defeat
  defeatHealth: 50,
  defeatClearRadius: 15, // robbers leave the truck after the fight
  defeatSupplies: 4, // enough to survive the walk back after patching up
};
