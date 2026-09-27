import { beforeAll, expect, it } from "vitest";
import { emptyWorld } from "../sim/testkit";
import { endTurn, setMoveOrder } from "../sim/world";
import {
  buildDrive,
  captureDrive,
  freeDrive,
  initPhysics,
  restoreDrive,
  type Drive,
} from "./drive";
import { computeTurn, physicsMove } from "./turn";

beforeAll(initPhysics);

it("restores frozen terrain after worker transfer so turn clones retain the route cache", () => {
  const world = emptyWorld();
  const drive = buildDrive(world);
  const { terrain, ...state } = structuredClone(world);
  expect(Object.isFrozen(terrain)).toBe(false);
  try {
    computeTurn({ world: state, drive: captureDrive(drive) }, terrain);
    expect(Object.isFrozen(terrain)).toBe(true);
    expect(Object.isFrozen(terrain.heights)).toBe(true);
    expect(Object.isFrozen(terrain.types)).toBe(true);
  } finally {
    freeDrive(drive);
  }
});

it("computes the same world and physics as a foreground turn without advancing the input", () => {
  const world = setMoveOrder(emptyWorld(), {
    kind: "stopAt",
    dest: { x: 38, y: 31 },
  });
  const original = structuredClone(world);
  const drive = buildDrive(world);
  let expectedDrive: Drive | null = null;
  let restored: Drive | null = null;
  try {
    const { terrain, ...state } = world;
    const prepared = computeTurn(
      { world: state, drive: captureDrive(drive) },
      terrain,
    );
    const expected = endTurn(
      world,
      physicsMove(drive, (result) => {
        expectedDrive = result.next;
      }),
    );
    expect({ ...prepared.world, terrain }).toEqual(expected);
    expect(world).toEqual(original);
    restored = restoreDrive(prepared.result.next);
    const nextPrepared = computeTurn(
      { world: prepared.world, drive: captureDrive(restored) },
      terrain,
    );
    const nextExpected = endTurn(
      expected,
      physicsMove(restored, (result) => freeDrive(result.next)),
    );
    expect({ ...nextPrepared.world, terrain }).toEqual(nextExpected);
  } finally {
    freeDrive(drive);
    if (expectedDrive) freeDrive(expectedDrive);
    if (restored) freeDrive(restored);
  }
});
