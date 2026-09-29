import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  buildDrive,
  captureDrive,
  freeDrive,
  initPhysics,
  type Drive,
} from "../phys/drive";
import type { PreparedTurn, TurnRequest, TurnResponse } from "../phys/turn";
import { emptyWorld } from "../sim/testkit";
import { setMoveOrder } from "../sim/world";
import type { World } from "../sim/types";
import { TurnPreparation } from "./travel";

class TestWorker {
  static latest: TestWorker;
  requests: TurnRequest[] = [];
  onmessage: ((event: MessageEvent<TurnResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  constructor() {
    TestWorker.latest = this;
  }
  postMessage(request: TurnRequest): void {
    this.requests.push(request);
  }
  respond(response: TurnResponse): void {
    if (!this.onmessage) throw new Error("Missing worker response handler");
    this.onmessage({ data: response } as MessageEvent<TurnResponse>);
  }
}

let world: World;
let drive: Drive;
let reply: PreparedTurn;
beforeAll(initPhysics);
beforeEach(() => {
  vi.stubGlobal("Worker", TestWorker);
  world = emptyWorld();
  drive = buildDrive(world);
  const { terrain: _terrain, ...state } = world;
  reply = {
    world: state,
    result: { next: captureDrive(drive), frames: {}, crashes: [], breaks: [], landings: [], results: {} },
  };
});
afterEach(() => {
  freeDrive(drive);
  vi.unstubAllGlobals();
});

it("prepares once and exposes a result only when ready for the same world", () => {
  const turns = new TurnPreparation();
  turns.prepare(world, drive);
  turns.prepare(world, drive);
  expect(turns.take(world)).toBeNull();
  const worker = TestWorker.latest;
  expect(worker?.requests).toHaveLength(1);
  worker.respond({ id: worker.requests[0].id, turn: reply, perf: {} });
  expect(turns.take(world)).toBe(reply);
  expect(turns.take(world)).toBeNull();
});

it("discards a stale result after replanning and sends stable terrain only once", () => {
  const turns = new TurnPreparation();
  turns.prepare(world, drive);
  const changed = setMoveOrder(world, {
    kind: "stopAt",
    dest: { x: 38, y: 31 },
  });
  turns.prepare(changed, drive);
  const worker = TestWorker.latest;
  expect(worker?.requests).toHaveLength(2);
  expect(worker.requests[0].terrain).toBe(world.terrain);
  expect(worker.requests[1].terrain).toBeNull();
  worker.respond({ id: worker.requests[0].id, turn: reply, perf: {} });
  expect(turns.take(changed)).toBeNull();
  worker.respond({ id: worker.requests[1].id, turn: reply, perf: {} });
  expect(turns.take(world)).toBeNull();
  expect(turns.take(changed)).toBe(reply);
});

it("reports calculation failures instead of continuing with stale results", () => {
  const turns = new TurnPreparation();
  turns.prepare(world, drive);
  const worker = TestWorker.latest;
  expect(worker?.requests).toHaveLength(1);
  expect(() =>
    worker.respond({ id: worker.requests[0].id, error: "physics failed" }),
  ).toThrow("physics failed");
});
