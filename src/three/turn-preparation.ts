import { captureDrive, type Drive } from "../phys/drive";
import type { PreparedTurn } from "../phys/turn-task";
import type { TurnRequest, TurnResponse } from "../phys/turn-worker";
import type { World } from "../sim/types";
import { mergePerf } from "../perf";

export class TurnPreparation {
  private worker: Worker | null = null;
  private terrain: World["terrain"] | null = null;
  private serial = 0;
  private pending: { id: number; before: World; ready: PreparedTurn | null } | null = null;

  private createWorker(): Worker {
    const worker = new Worker(new URL("../phys/turn-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<TurnResponse>) => {
      const response = event.data;
      if ("error" in response) throw new Error(response.error);
      mergePerf(response.perf);
      if (this.pending?.id === response.id) this.pending.ready = response.turn;
    };
    worker.onerror = (event) => { throw new Error(`Turn worker failed: ${event.message}`); };
    worker.onmessageerror = () => { throw new Error("Could not read turn worker response"); };
    return worker;
  }

  prepare(world: World, drive: Drive): void {
    if (this.pending?.before === world) return;
    const { terrain, ...state } = world;
    const saved = captureDrive(drive);
    const id = ++this.serial;
    this.pending = { id, before: world, ready: null };
    // Terrain identity owns route caches, so keep one terrain instance in the worker.
    this.worker ??= this.createWorker();
    this.worker.postMessage({
      id, world: state, drive: saved, terrain: this.terrain === terrain ? null : terrain,
    } satisfies TurnRequest, [saved.snapshot.buffer as ArrayBuffer]);
    this.terrain = terrain;
  }

  take(world: World): PreparedTurn | null {
    if (this.pending?.before !== world || !this.pending.ready) return null;
    const result = this.pending.ready;
    this.pending = null;
    return result;
  }
}
