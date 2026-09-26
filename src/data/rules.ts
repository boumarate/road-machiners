// Global rule numbers. Tuned by playing.

export const RULES = {
  // Movement
  substeps: 20, // per turn; step length must stay below the smallest collision radius
  crawlSpeed: 1, // speed used for sharp turns
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
  minSpeedCap: 1, // parts penalties never push max speed below this
  collisionMinImpact: 1.5, // slower bumps deal no damage
  collisionDamage: 4, // hull damage per tile/turn of impact speed, scaled by mass ratio
  collisionPartChance: 0.3, // chance a collision also damages a random part

  // Combat
  rangeFalloff: 0.3, // hit chance lost at max range
  speedEvasion: 0.03, // hit chance lost per tile/turn of target speed
  aimedPenalty: 0.25,
  minHit: 0.05,
  maxHit: 0.95,
  killXp: 40,
  wreckRadiusScale: 1, // wreck obstacle radius relative to the vehicle
  maxKillWrecks: 12, // oldest wrecks from kills are cleared past this, so obstacles do not pile up

  // Supplies, per turn
  waterPerTurn: 0.25,
  foodPerTurn: 0.25,
  waterCap: 20,
  foodCap: 20,
  starveDamage: 5, // character health lost per turn per empty supply
  maxHealth: 100,

  // Progress
  xpPerLevel: 100, // level n needs n * xpPerLevel more
  startSkillPoints: 2,
  maxSkillLevel: 5,
  discoverXp: 25,
  tradeXpPerProfit: 0.3, // xp per money unit of profit on a sale

  // Defeat
  defeatMoneyLoss: 0.5,
  defeatHull: 0.25,
  defeatHealth: 50,
  defeatClearRadius: 15, // hostiles within this range of the wake town leave
  defeatSupplies: { fuel: 8, water: 4, food: 4 }, // townsfolk top you up to at least this, so a broke player can move on
};
