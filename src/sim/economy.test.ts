import { START_KITS } from "../data/start";
import { describe, expect, it } from "vitest";
import { CHASSIS } from "../data/chassis";
import { ECONOMY, GOOD_IDS, TOWN_PRICES } from "../data/goods";
import { partDef } from "../data/parts";
import { REGION } from "../data/region";
import { RULES } from "../data/rules";
import {
  buyChassis,
  buyGood,
  buyPart,
  buyPrice,
  buySupply,
  chassisTradeIn,
  partRepairCost,
  repairAll,
  repairPart,
  sellGood,
  sellPrice,
  serviceVehicle,
} from "./economy";
import {
  corePart,
  coreParts,
  freeCells,
  goodsCount,
  mountedParts,
} from "./grid";
import { spareParts } from "./inventory";
import { canScavenge, salvageNear, scavenge, useOasis } from "./locations";
import { gainXp, spendSkillPoint, xpForLevel } from "./progress";
import { vehicleStats } from "./stats";
import { consumeSupplies } from "./supplies";
import { heatAt } from "./sun";
import { locationAt, siteGates, townAt, townNear } from "./sites";
import { addVehicle, emptyWorld } from "./testkit";
import { endTurn, newWorld } from "./world";

const bowl = REGION.towns.find((t) => t.id === "bowl")!;
const nose = REGION.towns.find((t) => t.id === "nose")!;
const startAtBowl = () => emptyWorld(siteGates(bowl)[0]);

describe("trade", () => {
  it("buying moves money into cargo", () => {
    const w = buyGood(startAtBowl(), "scrap", 3);
    expect(goodsCount(w.vehicles[0]).scrap).toBe(2 + 3);
    expect(w.player.money).toBe(1500 - 3 * buyPrice(w, "bowl", "scrap"));
  });

  it("enforces cargo capacity and money", () => {
    const w = startAtBowl();
    w.player.money = 10000;
    expect(() => buyGood(w, "scrap", freeCells(w.vehicles[0]) + 1)).toThrow(
      /cargo space/,
    );
    w.player.money = 300;
    expect(() => buyGood(w, "meds", 10)).toThrow(/money/);
  });

  it("the scrap route pays and gives XP", () => {
    let w = buyGood(startAtBowl(), "scrap", 8);
    w.vehicles[0].pos = { ...siteGates(nose)[0] };
    const money = w.player.money;
    w = sellGood(w, "scrap", 10);
    expect(w.player.money - money).toBe(10 * sellPrice(w, "nose", "scrap"));
    expect(sellPrice(w, "nose", "scrap")).toBeGreaterThan(
      buyPrice(w, "bowl", "scrap"),
    );
    expect(w.player.xp).toBeGreaterThan(0);
  });

  it("trade skill narrows the spread", () => {
    const w = startAtBowl();
    const before = buyPrice(w, "bowl", "salt") - sellPrice(w, "bowl", "salt");
    w.player.skills.trade = 3;
    expect(
      buyPrice(w, "bowl", "salt") - sellPrice(w, "bowl", "salt"),
    ).toBeLessThan(before);
  });

  it("town services need a town", () => {
    expect(() => buyGood(emptyWorld({ x: 30, y: 30 }), "scrap", 1)).toThrow(
      /town/,
    );
  });

  it("prices exist for every good in every town", () => {
    for (const t of REGION.towns)
      expect(Object.keys(TOWN_PRICES[t.id]).sort()).toEqual(
        [...GOOD_IDS].sort(),
      );
  });
});

describe("garage", () => {
  it("buys supplies up to the cap", () => {
    const start = startAtBowl();
    start.player.supplies = 12;
    const w = buySupply(start, "supplies", RULES.suppliesCap - 12);
    expect(w.player.supplies).toBe(RULES.suppliesCap);
    expect(() => buySupply(w, "supplies", 1)).toThrow();
  });

  it("repairs parts for money", () => {
    const w = startAtBowl();
    corePart(w.vehicles[0], "cab").hp = 10;
    mountedParts(w.vehicles[0])[0].hp = 0;
    const r = repairAll(w);
    expect(corePart(r.vehicles[0], "cab").hp).toBe(partDef("cab").hp);
    expect(mountedParts(r.vehicles[0])[0].hp).toBeGreaterThan(0);
    expect(r.player.money).toBeLessThan(1500);
  });

  it("repairs only the selected truck part for its quoted cost", () => {
    const w = startAtBowl();
    const cab = corePart(w.vehicles[0], "cab");
    const wheel = coreParts(w.vehicles[0], "wheel")[0];
    cab.hp = 10;
    wheel.hp = 1;
    const cost = partRepairCost(w, cab);

    const repaired = repairPart(w, cab.id);

    expect(corePart(repaired.vehicles[0], "cab").hp).toBe(
      partDef(cab.defId).hp,
    );
    expect(coreParts(repaired.vehicles[0], "wheel")[0].hp).toBe(1);
    expect(repaired.player.money).toBe(w.player.money - cost);
    expect(cab.hp).toBe(10);
  });

  it("rejects an unknown part, a part outside the truck, and insufficient money", () => {
    const w = startAtBowl();
    const cab = corePart(w.vehicles[0], "cab");
    cab.hp = 10;
    expect(() => repairPart(w, "missing")).toThrow(/part/);
    w.player.storage.push({ ...cab, id: "stored" });
    expect(() => repairPart(w, "stored")).toThrow(/part/);
    w.player.money = 0;
    expect(() => repairPart(w, cab.id)).toThrow(/money/);
    expect(cab.hp).toBe(10);
  });

  it("requires a town for individual repairs", () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const cab = corePart(w.vehicles[0], "cab");
    cab.hp = 10;
    expect(() => repairPart(w, cab.id)).toThrow(/town/);
    expect(cab.hp).toBe(10);
  });

  it("chassis swap keeps fitting parts and stores the rest", () => {
    let w = startAtBowl();
    w.player.money = 2000;
    w = buyChassis(w, "hauler");
    const me = w.vehicles[0];
    expect(me.chassisId).toBe("hauler");
    expect(
      mountedParts(me)
        .map((p) => p.defId)
        .filter((id) => partDef(id).kind !== "core")
        .sort(),
    ).toEqual(["cage", "mg", "rack", "stockEngine"]);
    expect(goodsCount(me)).toEqual({ scrap: 2, parts: 2 });
    expect(w.player.money).toBe(
      2000 -
        (CHASSIS.hauler.price -
          Math.floor(CHASSIS.scout.price * ECONOMY.chassisSellFactor)),
    );
    w = buyChassis(w, "scout");
    expect(w.player.storage.length).toBe(0);
  });

  it("trade-in drops with built-in part damage", () => {
    const w = startAtBowl();
    const whole = chassisTradeIn(w);
    coreParts(w.vehicles[0], "wheel")[0].hp = 0;
    expect(chassisTradeIn(w)).toBeLessThan(whole);
  });
});

describe("supplies", () => {
  it("supplies drain each turn and running out hurts health", () => {
    const w = emptyWorld();
    w.player.supplies = 0.01;
    consumeSupplies(w);
    expect(w.player.supplies).toBe(0);
    expect(w.player.health).toBe(RULES.maxHealth - RULES.starveDamage);
  });

  it("drains suppliesPerTurn times heat over ten turns", () => {
    const w = emptyWorld();
    const heat = heatAt(w, w.vehicles[0].pos);
    const before = w.player.supplies;
    for (let i = 0; i < 10; i++) consumeSupplies(w);
    expect(w.player.supplies).toBeCloseTo(
      before - 10 * RULES.suppliesPerTurn * heat,
    );
  });

  it("survival cuts use", () => {
    const w = emptyWorld();
    const heat = heatAt(w, w.vehicles[0].pos);
    w.player.skills.survival = 2;
    const before = w.player.supplies;
    consumeSupplies(w);
    expect(before - w.player.supplies).toBeLessThan(RULES.suppliesPerTurn * heat);
  });
});

describe("locations", () => {
  it("towns work only near a gate, and open locations use a 1.5x interaction radius", () => {
    const gate = siteGates(bowl)[0];
    const out = { x: gate.x - bowl.pos.x, y: gate.y - bowl.pos.y };
    const reach = REGION.settlement.gateReach;
    expect(
      townAt(
        emptyWorld({
          x: gate.x + (out.x / bowl.radius) * (reach - 0.01),
          y: gate.y + (out.y / bowl.radius) * (reach - 0.01),
        }),
      )?.id,
    ).toBe(bowl.id);
    expect(
      townAt(
        emptyWorld({
          x: gate.x + (out.x / bowl.radius) * (reach + 0.01),
          y: gate.y + (out.y / bowl.radius) * (reach + 0.01),
        }),
      ),
    ).toBeNull();
    // The far side of the wall is out of reach, though it is as close to the center as the gate.
    expect(
      townAt(
        emptyWorld({
          x: bowl.pos.x - out.x * 1.1,
          y: bowl.pos.y - out.y * 1.1,
        }),
      ),
    ).toBeNull();
    const oasis = REGION.locations.find((l) => l.kind === "oasis")!;
    const locationReach = (oasis.radius + ECONOMY.useRange) * 1.5;
    expect(
      locationAt(
        emptyWorld({ x: oasis.pos.x + locationReach - 0.01, y: oasis.pos.y }),
      )?.id,
    ).toBe(oasis.id);
    expect(
      locationAt(
        emptyWorld({ x: oasis.pos.x + locationReach + 0.01, y: oasis.pos.y }),
      ),
    ).toBeNull();
  });

  it("oasis refills supplies", () => {
    const oasis = REGION.locations.find((l) => l.kind === "oasis")!;
    const w = emptyWorld({ x: oasis.pos.x + 2, y: oasis.pos.y });
    w.player.supplies = 1;
    useOasis(w);
    expect(w.player.supplies).toBe(RULES.suppliesCap);
  });

  it("convoy starts a timed search, and a second search cannot start while it runs", () => {
    const convoy = REGION.locations.find((l) => l.kind === "convoy")!;
    const w = emptyWorld({ x: convoy.pos.x + 2, y: convoy.pos.y });
    const after = scavenge(w);
    expect(after.vehicles[0].job).toEqual(
      expect.objectContaining({ kind: "search", stockId: convoy.id }),
    );
    expect(() => scavenge(after)).toThrow();
  });

  it("a town in reach needs a stop before it can be used", () => {
    const gate = siteGates(REGION.towns[0])[0];
    const w = emptyWorld({ ...gate });
    w.vehicles[0].speed = RULES.parkedSpeed + 1;
    expect(townAt(w)).toBeNull();
    expect(townNear(w)?.id).toBe(REGION.towns[0].id);
  });

  it("salvage in range needs a stop before it can be searched", () => {
    const convoy = REGION.locations.find((l) => l.kind === "convoy")!;
    const w = emptyWorld({ x: convoy.pos.x + 2, y: convoy.pos.y });
    w.vehicles[0].speed = RULES.parkedSpeed + 1;
    expect(canScavenge(w)).toBe(false);
    expect(salvageNear(w)?.id).toBe(convoy.id);
  });

  it("driving near a site discovers it once, with XP", () => {
    let w = newWorld(5, START_KITS.standard);
    const convoy = REGION.locations.find((l) => l.kind === "convoy")!;
    w.vehicles.find((v) => v.faction === "player")!.pos = {
      x: convoy.pos.x + 3.5,
      y: convoy.pos.y + 3.5,
    };
    w = endTurn(w);
    expect(w.player.discovered).toContain("burnt-convoy");
    expect(
      w.events.filter((e) => e.t === "discover" && e.location === convoy.id),
    ).toHaveLength(1);
    w = endTurn(w);
    expect(
      w.events.filter((e) => e.t === "discover" && e.location === convoy.id),
    ).toHaveLength(0);
  });
});

describe("progress", () => {
  it("levels grant skill points", () => {
    const w = emptyWorld();
    const points = w.player.skillPoints;
    gainXp(w, xpForLevel(3), "test");
    expect(w.player.level).toBe(3);
    expect(w.player.skillPoints).toBe(points + 2);
  });

  it("spending a point raises the skill and each skill changes its number", () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const turn = vehicleStats(w, me).turnSlow;
    spendSkillPoint(w, "driving");
    expect(vehicleStats(w, me).turnSlow).toBeGreaterThan(turn);
    w.player.skillPoints = 0;
    expect(() => spendSkillPoint(w, "gunnery")).toThrow();
  });
});

describe("debt", () => {
  it("a player in debt cannot buy anything", () => {
    const w = startAtBowl();
    w.player.money = -100;
    expect(() => buyGood(w, "scrap", 1)).toThrow(/money/);
    expect(() => buySupply(w, "fuel", 1)).toThrow(/money/);
    expect(() => buyPart(w, "mg")).toThrow(/money/);
    expect(() => repairAll(w)).toThrow(/money/);
    // A chassis swap that costs nothing is still a purchase.
    w.player.money = -1;
    expect(() => buyChassis(w, "courier")).toThrow(/money/);
  });

  it("sales pay the debt down", () => {
    const w = startAtBowl();
    w.player.money = -100;
    const after = sellGood(w, "scrap", 2);
    expect(after.player.money).toBe(-100 + 2 * sellPrice(w, "bowl", "scrap"));
  });

  it("an NPC in debt gets no fuel, supplies or repairs in town", () => {
    const w = startAtBowl();
    const npc = addVehicle(w, "traders", "hauler", ["stockEngine"], { ...siteGates(bowl)[0] });
    npc.resources!.money = -50;
    npc.resources!.fuel = 1;
    npc.resources!.supplies = 1;
    const engine = mountedParts(npc, "engine")[0];
    engine.hp = 1;
    serviceVehicle(w, npc, "bowl");
    expect(npc.resources).toMatchObject({ money: -50, fuel: 1, supplies: 1 });
    expect(engine.hp).toBe(1);
  });
});
