import { describe, expect, it } from "vitest";
import { chassisDef } from "../data/chassis";
import { RULES } from "../data/rules";
import { corePart } from "../sim/grid";
import { emptyWorld } from "../sim/testkit";
import { maxHealthOf } from "../sim/health";
import { XP_TO_REACH } from "../data/skills";
import { addState, towData } from "../sim/states";
import { getContextAction, getHudReadout, getRescueReadout } from "./hud-readout";
import { REGION } from '../data/region';
import { sitePads } from '../sim/sites';

describe('oasis interaction', () => {
  it.each(REGION.locations.filter((site) => site.kind === 'oasis'))('offers refilling at $name only while stopped', (site) => {
    const w = emptyWorld({ ...sitePads(site)[0] });
    expect(getContextAction(w, false)).toEqual({ label: `Refill supplies at ${site.name}`, ready: true });
    w.vehicles[0].speed = RULES.parkedSpeed + 1;
    expect(getContextAction(w, false)).toEqual({ label: `Refill supplies at ${site.name}`, ready: false });
  });

  it('hides interaction during playback and while knocked out', () => {
    const site = REGION.locations.find((site) => site.kind === 'oasis')!;
    const w = emptyWorld({ ...sitePads(site)[0] });
    expect(getContextAction(w, true)).toBeNull();
    w.player.state = 'knockedOut';
    expect(getContextAction(w, false)).toBeNull();
  });
});

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
  it("shows driver health against the raised max health and warns below it", () => {
    const w = emptyWorld();
    w.player.skills.toughness = XP_TO_REACH[5];
    w.player.health = RULES.maxHealth;
    const driver = getHudReadout(w).resources.find((r) => r.label === "Driver")!;
    expect(driver).toEqual({ label: "Driver", value: `${RULES.maxHealth} / ${maxHealthOf(w)}`, warning: true });
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

describe("rescue readout", () => {
  it("shows negative money as debt with a warning", () => {
    const w = emptyWorld();
    w.player.money = -1200;
    expect(getHudReadout(w).resources[0]).toMatchObject({
      value: "Debt 1,200",
      warning: true,
    });
  });
  it("follows the player from stranded to tow, and leaves an open offer to the radio", () => {
    const w = emptyWorld();
    expect(getRescueReadout(w)).toBeNull();
    w.player.fuel = 0;
    expect(getRescueReadout(w)).toEqual({ kind: "stranded", beacon: false });
    w.player.beacon = true;
    expect(getRescueReadout(w)).toEqual({ kind: "stranded", beacon: true });
    w.player.money = 10;
    const tow = addState(w, "tow", w.vehicles[0].id, w.player.vehicleId, { kind: "tow", town: "bowl", fee: 50, hitched: false });
    expect(getRescueReadout(w)).toEqual({ kind: "stranded", beacon: true });
    towData(tow).hitched = true;
    expect(getRescueReadout(w)).toMatchObject({ kind: "towed", fee: 50 });
    w.player.state = "knockedOut";
    expect(getRescueReadout(w)).toEqual({ kind: "knockedOut" });
    w.player.state = "dead";
    expect(getRescueReadout(w)).toBeNull();
  });
});
