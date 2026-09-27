import type { World } from "../sim/types";
import { endTurn } from "../sim/world";
import { captureDrive, freeDrive, restoreDrive, type DriveSnapshot, type TurnResult } from "./drive";
import { physicsMove } from "./turn";

export type TurnState = Omit<World, "terrain">;
export type TurnTask = {
  world: TurnState;
  drive: DriveSnapshot;
};
export type PreparedTurn = {
  world: TurnState;
  result: Omit<TurnResult, "next"> & { next: DriveSnapshot };
};

export function computeTurn(task: TurnTask, terrain: World["terrain"]): PreparedTurn {
  // Worker messages drop frozen flags. Turn clones must keep this terrain and its route cache.
  Object.freeze(terrain.heights);
  Object.freeze(terrain.types);
  Object.freeze(terrain);
  const drive = restoreDrive(task.drive);
  let result: TurnResult | null = null;
  try {
    const world = endTurn({ ...task.world, terrain }, physicsMove(drive, (next) => { result = next; }));
    if (!result) throw new Error("Turn ran without physics");
    const { terrain: ignored, ...state } = world;
    const { next, ...motion } = result as TurnResult;
    return { world: state, result: { ...motion, next: captureDrive(next) } };
  } finally {
    freeDrive(drive);
    if (result) freeDrive((result as TurnResult).next);
  }
}
