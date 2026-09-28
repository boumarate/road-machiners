// The clock. One turn is one step of the day; hours run 0 to 24.

export const TIME = {
  turnsPerDay: 300, // a Bowl to Nose road crossing takes 100 to 150 turns, about half a day
  startHour: 7,
  sunrise: 6,
  sunset: 20,
  noonElevation: 40, // degrees of sun height at midday
  sunHeat: 2.5, // heat multiplier in full sun at noon; 1 at the horizon, in shade or at night
  nightSight: 0.5, // sight radius multiplier at night
  shadeAlpha: 0.35, // opacity of the darken overlay on shaded, explored ground
  shadeReach: 25, // tiles a shade check steps toward the sun looking for a blocker
  shadeSamples: 20, // height samples per shade check, about one per AS2
  // Obstacle heights that can block the sun, in the same height units as terrain. Sites and water cast no shade.
  obstacleShade: { rock: 1.2, wreck: 1.6, building: 2.5 } as Record<
    string,
    number
  >,
};
