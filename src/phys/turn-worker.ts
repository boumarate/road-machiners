import type { World } from "../sim/types";
import { CHASSIS } from "../data/chassis";
import { warmRoutes } from "../sim/path";
import { perfSnapshot, resetPerf, type PerfStat } from "../perf";
import { initPhysics } from "./drive";
import { computeTurn, type PreparedTurn, type TurnTask } from "./turn-task";

export type TurnRequest = TurnTask & { id: number; terrain: World["terrain"] | null };
export type TurnResponse =
  | { id: number; turn: PreparedTurn; perf: Record<string, PerfStat> }
  | { id: number; error: string };

let terrain: World["terrain"] | null = null;
const ready = initPhysics();

self.onmessage = async (event: MessageEvent<TurnRequest>) => {
  const request = event.data;
  try {
    await ready;
    if (request.terrain) {
      terrain = request.terrain;
      warmRoutes({ ...request.world, terrain }, [...new Set(Object.values(CHASSIS).map((chassis) => chassis.radius))]);
    }
    if (!terrain) throw new Error("Turn worker has no terrain");
    resetPerf();
    const turn = computeTurn(request, terrain);
    self.postMessage({ id: request.id, turn, perf: perfSnapshot() } satisfies TurnResponse, {
      transfer: [turn.result.next.snapshot.buffer as ArrayBuffer],
    });
  } catch (error) {
    self.postMessage({
      id: request.id,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    } satisfies TurnResponse);
  }
};
