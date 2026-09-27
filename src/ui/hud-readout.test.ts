import { describe, expect, it } from "vitest";
import { chassisDef } from "../data/chassis";
import { RULES } from "../data/rules";
import { corePart } from "../sim/grid";
import { emptyWorld } from "../sim/testkit";
import { getHudReadout } from "./hud-readout";

describe("critical vehicle readout", () => {
  it("keeps money, survival resources, cab and driver condition visible", () => {
    const w = emptyWorld();
    w.player.money = 1234;
    w.player.fuel = 18.5;
    w.player.supplies = 7.25;
    expect(getHudReadout(w).resources.map((r) => r.label)).toEqual([
      "Money",
      "Fuel",
      "Supplies",
      "Cab",
      "Driver",
    ]);
    expect(
      getHudReadout(w)
        .resources.slice(0, 3)
        .map((r) => r.value),
    ).toEqual(["1,234", "93 / 200 L", "7.3"]);
  });
  it("warns at the actual fuel speed-limit threshold", () => {
    const w = emptyWorld();
    const threshold =
      chassisDef(w.vehicles[0].chassisId).fuelCap * RULES.lowFuelThreshold;
    w.player.fuel = threshold;
    expect(getHudReadout(w).resources[1].warning).toBe(false);
    w.player.fuel = threshold - 0.1;
    expect(getHudReadout(w).resources[1].warning).toBe(true);
  });
  it("exposes damaged parts and injured driver without opening a window", () => {
    const w = emptyWorld();
    corePart(w.vehicles[0], "cab").hp = 0;
    w.player.health = 25;
    w.player.supplies = 0;
    const r = getHudReadout(w);
    expect(r.broken).toBeGreaterThan(0);
    expect(r.resources.slice(2).every((r) => r.warning)).toBe(true);
  });
  it("keeps parked jobs out of the survival instruments", () => {
    const w = emptyWorld();
    w.vehicles[0].job = {
      kind: "search",
      stockId: "stock",
      turnsLeft: 2,
      total: 4,
    };
    expect(getHudReadout(w).survival.map((r) => r.label)).toEqual([
      "Time",
      "Heat",
      "Engine",
      "Weather",
    ]);
  });
  it("keeps reverse speed and manual driving explicit", () => {
    const w = emptyWorld();
    w.vehicles[0].speed = -2;
    w.vehicles[0].direct = true;
    expect(getHudReadout(w)).toMatchObject({ speed: "-29", manual: true });
  });
});
