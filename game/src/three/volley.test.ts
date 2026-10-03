import { describe, expect, it } from "vitest";
import type { Break, Crash, Landing } from "../phys/drive";
import type { GameEvent } from "../sim/types";
import { CollisionCues, collisionSteps } from "./volley";

const hit = (a: string, b: string): GameEvent => ({ t: "collision", a, b, hitsA: [], hitsB: [] });
const crash = (a: string, b: string, step: number) => ({ a, b, impact: 5, step }) as Crash;
const smash = (prop: string, vehicle: string, step: number): Break => ({ prop, vehicle, step });
const land = (vehicle: string, step: number): Landing => ({ vehicle, impact: 3, step });
const none = { crashes: [], breaks: [], landings: [] };

describe("collisionSteps", () => {
  it("matches a truck crash by pair in either order", () => {
    const timed = collisionSteps([hit("b", "a")], { ...none, crashes: [crash("a", "b", 12)] });
    expect(timed.map((t) => t.step)).toEqual([12]);
  });

  it("matches a ground crash and a landing of one truck once each", () => {
    const timed = collisionSteps([hit("a", "ground"), hit("a", "ground")], { ...none, crashes: [crash("a", "ground", 30)], landings: [land("a", 20)] });
    expect(timed.map((t) => t.step)).toEqual([30, 20]);
  });

  it("matches a break by prop and truck", () => {
    const timed = collisionSteps([hit("a", "fence1")], { ...none, breaks: [smash("fence1", "a", 7)] });
    expect(timed.map((t) => t.step)).toEqual([7]);
  });

  it("gives a far break no step", () => {
    expect(collisionSteps([hit("a", "fence1")], none).map((t) => t.step)).toEqual([null]);
  });

  it("takes each candidate once", () => {
    const timed = collisionSteps([hit("a", "b"), hit("a", "b")], { ...none, crashes: [crash("a", "b", 4)] });
    expect(timed.map((t) => t.step)).toEqual([4, null]);
  });
});

describe("collisionSteps with claymore blasts", () => {
  const blast = (vehicle: string, other: string): GameEvent => ({ t: "claymore", vehicle, other, pos: { x: 0, y: 0 }, hits: [], selfHits: [] });

  it("times each blast at the step of the crash it follows", () => {
    const timed = collisionSteps([hit("a", "b"), blast("a", "b"), blast("b", "a")], { ...none, crashes: [crash("a", "b", 12)] });
    expect(timed.map((t) => [t.event.t, t.step])).toEqual([["collision", 12], ["claymore", 12], ["claymore", 12]]);
  });

  it("throws on a blast that follows no crash of its trucks", () => {
    expect(() => collisionSteps([hit("a", "c"), blast("a", "b")], { ...none, crashes: [crash("a", "c", 3)] })).toThrow(/follows no crash/);
  });
});

describe("CollisionCues", () => {
  it("returns each event once, when its step is reached, and the rest when movement ends", () => {
    const [e1, e2, e3] = [hit("a", "b"), hit("a", "c"), hit("a", "d")];
    const cues = new CollisionCues([
      { event: e1 as never, step: 5 },
      { event: e2 as never, step: 9 },
      { event: e3 as never, step: null },
    ]);
    expect(cues.due(4)).toEqual([]);
    expect(cues.due(6)).toEqual([e1]);
    expect(cues.due(6)).toEqual([]);
    expect(cues.due(null)).toEqual([e2, e3]);
    expect(cues.due(null)).toEqual([]);
  });
});
