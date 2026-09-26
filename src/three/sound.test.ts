import { describe, expect, it } from "vitest";
import type { GameEvent } from "../sim/types";
import { MIX } from "../data/sounds";
import { driveCue, loopLevels, stingOf } from "./sound";

describe("stingOf", () => {
  it("plays the most important result only", () => {
    const events: GameEvent[] = [
      { t: "money", amount: 20, reason: "sale" },
      { t: "levelUp", level: 2 },
      { t: "discover", location: "oasis" },
    ];
    expect(stingOf(events, "p")).toBe("level-up");
  });
  it("ignores spending and other drivers' arrivals", () => {
    const events: GameEvent[] = [
      { t: "money", amount: -5, reason: "fuel" },
      { t: "arrived", vehicle: "npc1" },
    ];
    expect(stingOf(events, "p")).toBeNull();
    expect(stingOf([{ t: "arrived", vehicle: "p" }], "p")).toBe("arrive");
  });
});

describe("loopLevels", () => {
  const calm = { stormTiles: 100, danger: false };
  it("raises wind near storms", () => {
    expect(loopLevels(calm, MIX).windGain).toBe(MIX.wind.baseGain);
    expect(loopLevels({ ...calm, stormTiles: 0 }, MIX).windGain).toBe(MIX.wind.stormGain);
  });
  it("switches music to combat while in danger", () => {
    const l = loopLevels({ ...calm, danger: true }, MIX);
    expect([l.calmGain, l.combatGain]).toEqual([0, 1]);
  });
});

describe("driveCue", () => {
  const d = MIX.drive;
  it("stays silent while standing still", () => {
    expect(driveCue(0, 0, MIX)).toBeNull();
    expect(driveCue(d.movingMs / 2, d.movingMs / 2, MIX)).toBeNull();
  });
  it("picks the sound by speed change", () => {
    expect(driveCue(0, d.accelMs + d.movingMs, MIX)).toBe("drive-accel");
    expect(driveCue(10, 10, MIX)).toBe("drive-cruise");
    expect(driveCue(10, 10 - d.decelMs, MIX)).toBe("drive-decel");
    expect(driveCue(10, 10 - d.brakeMs, MIX)).toBe("drive-brake");
  });
});
