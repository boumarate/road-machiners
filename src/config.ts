// Game settings. Change these values to configure a new game and playback.

export const CONFIG = {
  startKit: 'standard',
  // A fixed world seed replays the same game. Null rolls a new seed for each new game.
  seed: null as number | null,
  combatShotMs: 450,
  combatReadMs: 1100,
  saveTurns: 20,
  autoTurnMs: 250,
  travelHoldMs: 250,
  travelFastSpeed: 4,
};
