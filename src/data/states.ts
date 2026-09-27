// State durations in turns. See src/sim/states.ts. null means the state has no timer and ends only by its checks.

import type { StateKindId } from '../sim/types';

export const STATE_TURNS: Record<StateKindId, number | null> = {
  // Sight or shots between the two parties reset it. 10 turns lets a chase lose sight behind a ridge or a
  // wreck for a while and pick the fight up again. A pursuer that stays out of sight longer gives up.
  feud: 10,
  // A failed robber leaves the same target alone for 30 turns. At 200 turns a day that is a few hours,
  // long enough for the target to drive well away before the robber may try again.
  backedOff: 30,
  // A tow lasts until the tower reaches town, the player lets go, or the tower is gone or in danger.
  tow: null,
  // A driver the player turned down never offers a tow to that player again.
  spurned: null,
};
