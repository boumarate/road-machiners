// Physics driving numbers. Lengths in meters, time in seconds, mass in kilograms.

export const PHYSICS = {
  metersPerTile: 4, // one map tile and one height unit are this many meters
  gravity: 9.81,
  stepsPerSecond: 60,
  turnSeconds: 1, // simulated time per turn; tiles per turn in the rules become tiles per second
  truck: {
    gravityScale: 2, // trucks fall faster than the world's gravity, so bumps do not throw them in the air
    comBelow: 0.7, // meters the center of mass sits below the chassis box center, near the axles, so trucks rarely flip
    inertiaScale: 2, // rotational inertia relative to a plain box of the same mass, so trucks resist rolling
    suspensionRest: 0.4,
    suspensionTravel: 0.3,
    suspensionStiffness: 30,
    suspensionCompression: 4,
    suspensionRelaxation: 5,
    maxSuspensionForce: 100000,
    frictionSlip: 2,
    sideFrictionStiffness: 1,
    engineAccel: 12, // m/s^2 the engine can give at full throttle, before damage
    brakeForce: 60, // per wheel per ton of mass, at full brake
    maxSteer: 0.6, // radians of front wheel angle
    steerRate: 3, // radians per second the wheels can turn
  },
  // Body per chassis look, in meters. half: chassis box half extents along length, height, width.
  // wheelX: front and rear axle distance from the center. wheelZ: wheel distance from the center line.
  // wheelY: suspension mount height relative to the chassis center. mass in kilograms.
  bodies: {
    pickup: { half: { x: 2.2, y: 0.45, z: 1.0 }, wheelX: 1.45, wheelZ: 0.95, wheelY: -0.3, wheelRadius: 0.45, wheelHalfWidth: 0.18, mass: 1500 },
    hauler: { half: { x: 3.0, y: 0.6, z: 1.3 }, wheelX: 2.0, wheelZ: 1.2, wheelY: -0.4, wheelRadius: 0.6, wheelHalfWidth: 0.25, mass: 4000 },
    buggy: { half: { x: 1.8, y: 0.35, z: 0.95 }, wheelX: 1.3, wheelZ: 1.0, wheelY: -0.2, wheelRadius: 0.5, wheelHalfWidth: 0.22, mass: 900 },
    wagon: { half: { x: 3.0, y: 0.7, z: 1.35 }, wheelX: 1.9, wheelZ: 1.25, wheelY: -0.45, wheelRadius: 0.6, wheelHalfWidth: 0.25, mass: 3500 },
  },
  driver: {
    steerGain: 1.6, // wheel angle per radian of heading error
    throttleGain: 0.5, // throttle per m/s of speed error
    stopDecel: 8, // m/s^2 a driver plans to brake at when stopping on a point
    reverseBelow: 4, // m/s; only a truck slower than this starts backing up
    reverseSpeed: 5, // m/s while backing up
  },
  rockHeight: 3, // meters of obstacle collider height
  rockSink: 0.5, // meters an obstacle collider reaches below the ground, so slopes leave no gap
  wallHeight: 200, // meters; half height of the walls at the map edge
} as const;
