import { describe, expect, it } from "vitest";
import type { GameEvent } from "../sim/types";
import { MIX } from "../data/sounds";
import { loopLevels, stingOf } from "./sound";

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
  const calm = { engineSpeed: null, stormTiles: 100, danger: false };
  it("keeps the engine silent between turns", () => {
    expect(loopLevels(calm, MIX).engineGain).toBe(0);
  });
  it("raises engine rate and gain with speed, capped at top speed", () => {
    const idle = loopLevels({ ...calm, engineSpeed: 0 }, MIX);
    const top = loopLevels({ ...calm, engineSpeed: MIX.engine.topSpeedMs * 2 }, MIX);
    expect(idle.engineGain).toBe(MIX.engine.idleGain);
    expect(idle.engineRate).toBe(MIX.engine.idleRate);
    expect(top.engineGain).toBe(1);
    expect(top.engineRate).toBe(MIX.engine.topRate);
  });
  it("raises wind near storms", () => {
    expect(loopLevels(calm, MIX).windGain).toBe(MIX.wind.baseGain);
    expect(loopLevels({ ...calm, stormTiles: 0 }, MIX).windGain).toBe(MIX.wind.stormGain);
  });
  it("switches music to combat while in danger", () => {
    const l = loopLevels({ ...calm, danger: true }, MIX);
    expect([l.calmGain, l.combatGain]).toEqual([0, 1]);
  });
});
