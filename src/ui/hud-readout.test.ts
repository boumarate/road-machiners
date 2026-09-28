import { describe, expect, it } from "vitest";
import { chassisDef } from "../data/chassis";
import { RULES } from "../data/rules";
import { corePart } from "../sim/grid";
import { knockOutNpc } from "../sim/defeat";
import { addVehicle, emptyWorld, npcBrain } from "../sim/testkit";
import { maxHealthOf } from "../sim/health";
import { XP_TO_REACH } from "../data/skills";
import { addState, towData } from "../sim/states";
import { getContextAction, getHudReadout, getRescueReadout } from "./hud-readout";
import { REGION } from '../data/region';
import { sitePads } from '../sim/sites';
import { partDef } from "../data/parts";
import { startKit } from "../data/start";
import { newWorld } from "../sim/world";
import { playerVehicle } from "../sim/damage";
import { stowPart } from "../sim/inventory";
import { TEST_MAP } from "../test/map";

describe('knocked-out truck interaction', () => {
  it('offers looting a knocked-out truck in reach only while stopped', () => {
    const w = emptyWorld();
    const gap = chassisDef('scout').radius + chassisDef('buggy').radius + 0.2;
    const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30 + gap, y: 30 });
    buggy.brain = npcBrain('buggy', buggy.pos, ['raider']);
    expect(getContextAction(w, false)).toBeNull();
    corePart(buggy, 'cab').hp = 0;
    knockOutNpc(w, buggy);
    expect(getContextAction(w, false)).toEqual({ label: `Loot ${buggy.name}`, ready: true });
    w.vehicles[0].speed = RULES.parkedSpeed + 1;
    expect(getContextAction(w, false)).toEqual({ label: `Loot ${buggy.name}`, ready: false });
  });
});

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

describe('salvage interaction', () => {
  it('says a site is picked clean when its stock is empty', () => {
    const site = REGION.locations.find((site) => site.id === 'podfield')!;
    const w = emptyWorld({ ...sitePads(site)[0] });
    w.salvage = [{ id: site.id, pos: { ...site.pos }, radius: site.radius, goods: { scrap: 1 }, parts: [] }];
    expect(getContextAction(w, false)).toEqual({ label: `Search ${site.name}`, ready: true });
    w.salvage[0].goods.scrap = 0;
    expect(getContextAction(w, false)).toEqual({ label: `${site.name} is picked clean`, ready: false, hint: 'No loot left' });
  });
});

describe("critical vehicle readout", () => {
  it("keeps money, survival resources and driver condition visible", () => {
    const w = emptyWorld();
    w.player.money = 1234;
    w.player.fuel = 18.5;
    w.player.supplies = 7.25;
    expect(getHudReadout(w).resources.map((r) => r.label)).toEqual([
      "Money",
      "Fuel",
      "Supplies",
      "Driver",
    ]);
    expect(
      getHudReadout(w)
        .resources.slice(0, 3)
        .map((r) => r.value),
    ).toEqual(["1,234", "93 / 200 L", "7.3"]);
  });
  it("shows fractional driver health as a whole number", () => {
    const w = emptyWorld();
    w.player.health = 41.123456789;
    const [, , , driver] = getHudReadout(w).resources.map((r) => r.value);
    expect(driver).toBe(`42 / ${RULES.maxHealth}`);
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
  it("tells a stranded player to install a spare engine it carries", () => {
    const w = newWorld(1337, startKit("standard"), TEST_MAP);
    const me = playerVehicle(w);
    const engine = me.items.find((it) => it.kind === "part" && partDef(it.part.defId).kind === "engine");
    if (!engine || engine.kind !== "part") throw new Error("Expected an engine");
    // Without the cargo and the cage, the roof row has room for the engine.
    me.items = me.items.filter((it) => it !== engine && it.kind === "part" && it.part.defId !== "cage");
    expect(getRescueReadout(w)).toMatchObject({ kind: "stranded", reason: "No working engine." });
    expect(stowPart(w, me, engine.part)).toBe(true);
    expect(getRescueReadout(w)).toMatchObject({ kind: "stranded", reason: "No working engine. Install the spare [I]." });
  });
  it("follows the player from stranded to tow, and leaves an open offer to the radio", () => {
    const w = emptyWorld();
    expect(getRescueReadout(w)).toBeNull();
    w.player.fuel = 0;
    expect(getRescueReadout(w)).toEqual({ kind: "stranded", beacon: false, reason: "Out of fuel." });
    w.player.beacon = true;
    expect(getRescueReadout(w)).toEqual({ kind: "stranded", beacon: true, reason: "Out of fuel." });
    w.player.money = 10;
    const tow = addState(w, "tow", w.vehicles[0].id, w.player.vehicleId, { kind: "tow", site: "bowl", fee: 50, waived: 0, hitched: false });
    expect(getRescueReadout(w)).toEqual({ kind: "stranded", beacon: true, reason: "Out of fuel." });
    towData(tow).hitched = true;
    expect(getRescueReadout(w)).toMatchObject({ kind: "towed", fee: 50 });
    w.player.state = "knockedOut";
    expect(getRescueReadout(w)).toEqual({ kind: "knockedOut" });
    w.player.state = "dead";
    expect(getRescueReadout(w)).toBeNull();
  });
});

describe('trade interaction', () => {
  // The player parked on a town pad, with a trader beside it that agreed to trade.
  function atTownWithTrader(npcSpeed: number) {
    const town = REGION.towns[0];
    const w = emptyWorld({ ...sitePads(town)[0] });
    const me = w.vehicles[0];
    const npc = addVehicle(w, 'traders', 'scout', [], { x: me.pos.x + 3, y: me.pos.y });
    npc.brain = npcBrain('trader', npc.pos, ['trader']);
    npc.speed = npcSpeed;
    addState(w, 'trade', npc.id, w.player.vehicleId, { kind: 'none' });
    return { w, town, npc };
  }

  it('offers the trade over the town once both trucks are parked side by side', () => {
    const { w, npc } = atTownWithTrader(0);
    expect(getContextAction(w, false)).toEqual({ label: `Trade with ${npc.name}`, ready: true });
  });

  it('offers the town while the trader still drives', () => {
    const { w, town } = atTownWithTrader(RULES.parkedSpeed + 1);
    expect(getContextAction(w, false)).toEqual({ label: `Enter ${town.name}`, ready: true });
  });
});
