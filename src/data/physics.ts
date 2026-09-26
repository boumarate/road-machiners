// Physics driving numbers. Lengths in meters, time in seconds, mass in kilograms.

export const PHYSICS = {
  metersPerTile: 4, // one map tile and one height unit are this many meters
  gravity: 9.81,
  stepsPerSecond: 60,
  turnSeconds: 2, // simulated time per turn
  truck: {
    halfSize: { x: 2.2, y: 0.45, z: 1.0 }, // chassis box half extents: length, height, width
    mass: 1500,
    wheelRadius: 0.45,
    wheelHalfWidth: 0.18,
    wheelX: 1.45, // front and rear axle distance from the center
    wheelZ: 0.95, // wheel distance from the center line
    wheelY: -0.3, // suspension mount height below the chassis center
    suspensionRest: 0.4,
    suspensionTravel: 0.3,
    suspensionStiffness: 30,
    suspensionCompression: 4,
    suspensionRelaxation: 5,
    maxSuspensionForce: 100000,
    frictionSlip: 2,
    sideFrictionStiffness: 1,
    engineForce: 4000, // per driven rear wheel, at full throttle
    brakeForce: 60, // per wheel, at full brake
    maxSteer: 0.6, // radians of front wheel angle
    steerRate: 1.5, // radians per second the wheels can turn
    maxSpeed: 17, // meters per second the driver aims for at most
  },
  driver: {
    steerGain: 1.6, // wheel angle per radian of heading error
    throttleGain: 0.5, // throttle per m/s of speed error
    arriveDistance: 2.5, // meters; closer than this the driver stops
    reverseAbove: 100, // degrees off the target from which a slow truck backs up
    reverseUntil: 50, // degrees off the target at which backing up ends
    reverseBelow: 3, // m/s; only a truck slower than this starts backing up
    reverseSpeed: 3, // m/s while backing up
  },
  rockHeight: 3, // meters of rock collider above the ground
} as const;
