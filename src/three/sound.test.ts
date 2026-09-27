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
  it("plays the defeat cue on a knockout", () => {
    expect(stingOf([{ t: "levelUp", level: 2 }, { t: "knockout" }], "p")).toBe("defeat");
  });
});

describe("loopLevels", () => {
  const calm = { stormTiles: 100, turnsSinceDanger: Infinity };
  it("raises wind near storms", () => {
    expect(loopLevels(calm, MIX).windGain).toBe(MIX.wind.baseGain);
    expect(loopLevels({ ...calm, stormTiles: 0 }, MIX).windGain).toBe(MIX.wind.stormGain);
  });
  it("switches music to combat while in danger", () => {
    const l = loopLevels({ ...calm, turnsSinceDanger: 0 }, MIX);
    expect([l.calmGain, l.combatGain]).toEqual([0, 1]);
  });
  it("holds combat music for a few turns after the last hostile leaves sight", () => {
    const hold = MIX.music.holdTurns;
    expect(loopLevels({ ...calm, turnsSinceDanger: hold }, MIX).combatGain).toBe(1);
    expect(loopLevels({ ...calm, turnsSinceDanger: hold + 1 }, MIX).combatGain).toBe(0);
  });
});

describe("engineGlide", () => {
  const e = MIX.engine;
  it("stays silent while standing still", () => {
    expect(engineGlide(0, 0, 1, MIX)).toBeNull();
  });
  it("revs up while speeding up and holds while cruising", () => {
    const up = engineGlide(0, e.topSpeedMs * 2, 1, MIX)!;
    expect([up.rateFrom, up.rateTo]).toEqual([e.idleRate, e.topRate + e.revUp]);
    expect([up.gainFrom, up.gainTo]).toEqual([e.idleGain, 1 + e.loadGain]);
    expect(up.brake).toBe(false);
    const cruise = engineGlide(10, 10, 1, MIX)!;
    expect(cruise.rateTo).toBe(cruise.rateFrom);
  });
  it("drops revs while slowing", () => {
    const g = engineGlide(10, 10 - e.loadMs, 1, MIX)!;
    expect(g.rateFrom - g.rateTo).toBeGreaterThan(e.revDown);
  });
  it("adds the air brake on a hard slowdown only", () => {
    expect(engineGlide(10, 10 - e.brakeMs, 1, MIX)!.brake).toBe(true);
    expect(engineGlide(10, 10 - e.brakeMs / 2, 1, MIX)!.brake).toBe(false);
  });
});
