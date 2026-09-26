import { describe, expect, it } from "vitest";
import type { GameEvent } from "../sim/types";
import { MIX } from "../data/sounds";
import { engineGlide, loopLevels, stingOf } from "./sound";

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
    expect(stingOf([{ t: "arrived", vehicle: "p" }], "p")).toBe("air-brake");
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

describe("engineGlide", () => {
  const e = MIX.engine;
  it("stays silent while standing still", () => {
    expect(engineGlide(0, 0, 1, MIX)).toBeNull();
  });
  it("follows speed from the start to the end of the turn", () => {
    const g = engineGlide(0, e.topSpeedMs * 2, 1, MIX)!;
    expect([g.rateFrom, g.rateTo]).toEqual([e.idleRate, e.topRate]);
    expect([g.gainFrom, g.gainTo]).toEqual([e.idleGain, 1]);
    expect(g.brake).toBe(false);
  });
  it("adds the air brake on a hard slowdown only", () => {
    expect(engineGlide(10, 10 - e.brakeMs, 1, MIX)!.brake).toBe(true);
    expect(engineGlide(10, 10 - e.brakeMs / 2, 1, MIX)!.brake).toBe(false);
  });
});
