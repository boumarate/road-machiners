import { START_KITS } from "../data/start";
import { describe, expect, it } from "vitest";
import { XP_TO_REACH } from "../data/skills";
import { CHASSIS } from "../data/chassis";
import { ECONOMY, GOOD_IDS } from "../data/goods";
import { SHOPS } from "../data/market";
import { goodBasePrice, lotPrice, shopState } from "./market";
import { PARTS, partDef } from "../data/parts";
import { REGION } from "../data/region";
import { RULES } from "../data/rules";
import { CONDITION } from "../data/wear";
import {
  buyChassis,
  buyGood,
  buyStockPart,
  buyPrice,
  buySupply,
  chassisTradeIn,
  getLotTradePrice,
  partRepairCost,
  partTradePrice,
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
import { makePart } from "./factory";
import { maxHp, partValue } from "./wear";
import { addGoods, spareParts } from "./inventory";
import { applySiteAction, canScavenge, salvageNear, scavenge, useOasis } from "./locations";
import { consumeSupplies } from "./supplies";
import { heatAt } from "./sun";
import { sitePads, townAt, townNear } from "./sites";
import { addVehicle, emptyWorld, testDrive } from "./testkit";
import { endTurn, newWorld } from "./world";

const bowl = REGION.towns.find((t) => t.id === "bowl")!;
const nose = REGION.towns.find((t) => t.id === "nose")!;
const startAtBowl = () => emptyWorld(sitePads(bowl)[0]);

describe("trade", () => {
  it("buying moves money into cargo", () => {
    const start = startAtBowl();
    const price = buyPrice(start, "bowl", "scrap");
    const w = buyGood(start, "scrap", 3);
    expect(goodsCount(w.vehicles[0]).scrap).toBe(2 + 3);
    expect(w.player.money).toBe(1000 - 3 * price);
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

  it("the scrap route pays and trains Social", () => {
    const start = startAtBowl();
    const bought = buyPrice(start, "bowl", "scrap");
    let w = buyGood(start, "scrap", 8);
    w.vehicles[0].pos = { ...sitePads(nose)[0] };
    const money = w.player.money;
    const sold = sellPrice(w, "nose", "scrap");
    expect(sold).toBeGreaterThan(bought);
    const total = getLotTradePrice(w, w.vehicles[0], "nose", "scrap", 10, "sell");
    w = sellGood(w, "scrap", 10);
    expect(w.player.money - money).toBe(total);
    expect(w.player.skills.social).toBeGreaterThan(0);
  });

  it("buying raises the local price and selling lowers it", () => {
    const w = startAtBowl();
    const before = buyPrice(w, "bowl", "scrap");
    const after = buyGood(w, "scrap", 5);
    expect(buyPrice(after, "bowl", "scrap")).toBeGreaterThan(before);
    const sold = sellGood(after, "scrap", 7);
    expect(buyPrice(sold, "bowl", "scrap")).toBeLessThan(buyPrice(after, "bowl", "scrap"));
  });

  it("social narrows the spread", () => {
    const w = startAtBowl();
    const before = buyPrice(w, "bowl", "salt") - sellPrice(w, "bowl", "salt");
    w.player.skills.social = XP_TO_REACH[3];
    expect(
      buyPrice(w, "bowl", "salt") - sellPrice(w, "bowl", "salt"),
    ).toBeLessThan(before);
  });

  it("trade needs a shop", () => {
    expect(() => buyGood(emptyWorld({ x: 30, y: 30 }), "scrap", 1)).toThrow(
      /shop/,
    );
  });

  it("every garage prices every good", () => {
    for (const [id] of Object.entries(SHOPS).filter(([, s]) => s.kind === "garage"))
      for (const good of GOOD_IDS) expect(goodBasePrice(id, good)).toBeGreaterThan(0);
  });

  it("a lot price equals the sum of single-unit trades", () => {
    const w = startAtBowl();
    const state = shopState(w, "bowl");
    for (const direction of ["buy", "sell"] as const) {
      const lot = lotPrice("bowl", state, "scrap", direction, ECONOMY.spread, 25);
      let summed = 0;
      const pressure = { ...state.pressure };
      for (let i = 0; i < 25; i++) {
        summed += lotPrice("bowl", { ...state, pressure }, "scrap", direction, ECONOMY.spread, 1);
        pressure.scrap = (pressure.scrap ?? 0) + SHOPS.bowl.pressurePerUnit * (direction === "buy" ? 1 : -1);
      }
      expect(lot).toBe(summed);
    }
  });

  it.each([0, XP_TO_REACH[3]])(
    "selling then buying back 25 units always loses money, at social skill %i",
    (social) => {
      for (const pressureStart of [0, 0.3, -0.3]) {
        const w = startAtBowl();
        w.player.skills.social = social;
        w.shops.bowl.pressure.scrap = pressureStart;
        addGoods(w, w.vehicles[0], "scrap", 25 - (goodsCount(w.vehicles[0]).scrap ?? 0));

        const before = w.player.money;
        const after = buyGood(sellGood(w, "scrap", 25), "scrap", 25);
        expect(after.player.money).toBeLessThan(before);
      }
    },
  );

  it.each([0, XP_TO_REACH[3]])(
    "buying then selling back 25 units always loses money, at social skill %i",
    (social) => {
      for (const pressureStart of [0, 0.3, -0.3]) {
        const w = startAtBowl();
        w.player.skills.social = social;
        w.shops.bowl.pressure.scrap = pressureStart;

        const before = w.player.money;
        const after = sellGood(buyGood(w, "scrap", 25), "scrap", 25);
        expect(after.player.money).toBeLessThan(before);
      }
    },
  );
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
    expect(r.player.money).toBeLessThan(1000);
  });

  it("refuses to rebuild a junk part and leaves it out of repair all", () => {
    const w = startAtBowl();
    const junk = mountedParts(w.vehicles[0])[0];
    junk.hp = 0;
    junk.wear = CONDITION.maxWear + 1;
    corePart(w.vehicles[0], "cab").hp = 10;

    expect(() => repairPart(w, junk.id)).toThrow(/junk/);
    const r = repairAll(w);

    expect(mountedParts(r.vehicles[0])[0].hp).toBe(0);
    expect(corePart(r.vehicles[0], "cab").hp).toBe(partDef("cab").hp);
  });

  it("repairs a worn part up to its worn max HP", () => {
    const w = startAtBowl();
    const cab = corePart(w.vehicles[0], "cab");
    cab.wear = 2;
    cab.hp = 0;
    const r = repairPart(w, cab.id);
    expect(corePart(r.vehicles[0], "cab")).toMatchObject({ hp: maxHp(cab), wear: 2 });
    expect(maxHp(cab)).toBeLessThan(partDef("cab").hp);
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
        (CHASSIS.hauler.value -
          Math.floor(CHASSIS.scout.value * ECONOMY.chassisSellFactor)),
    );
    w = buyChassis(w, "scout");
    expect(w.player.storage.length).toBe(0);
  });

  it("refunds the difference when the trade-in beats the new chassis price", () => {
    let w = startAtBowl();
    w.player.money = 5000;
    w = buyChassis(w, "carrier");
    const tradeIn = chassisTradeIn(w);
    expect(tradeIn).toBeGreaterThan(CHASSIS.scout.value);
    const before = w.player.money;
    w = buyChassis(w, "scout");
    expect(w.player.money).toBe(before + (tradeIn - CHASSIS.scout.value));
  });

  it("trade-in drops with built-in part damage", () => {
    const w = startAtBowl();
    const whole = chassisTradeIn(w);
    coreParts(w.vehicles[0], "wheel")[0].hp = 0;
    expect(chassisTradeIn(w)).toBeLessThan(whole);
  });

  it("trade-in drops with worn built-in parts, even at full health", () => {
    const w = startAtBowl();
    const whole = chassisTradeIn(w);
    for (const wheel of coreParts(w.vehicles[0], "wheel")) wheel.wear = 2;
    expect(chassisTradeIn(w)).toBeLessThan(whole);
  });
});

describe("part value and trade price", () => {
  it("wear lowers value", () => {
    const pristine = makePart(startAtBowl(), "mg", 0);
    const worn = makePart(startAtBowl(), "mg", 2);
    expect(partValue(worn)).toBeLessThan(partValue(pristine));
  });

  it("sells a broken part for its scrap floor", () => {
    const w = startAtBowl();
    const part = makePart(w, "mg", 0);
    part.hp = 0;
    const floor = Math.round(ECONOMY.scrapPerKg * partDef("mg").mass);
    expect(partTradePrice(w, w.vehicles[0], part, "sell")).toBe(floor);
  });

  it("sell is always below buy at the same place", () => {
    const w = startAtBowl();
    const part = makePart(w, "mg", 1);
    part.hp = Math.floor(maxHp(part) * 0.6);
    expect(partTradePrice(w, w.vehicles[0], part, "sell")).toBeLessThan(
      partTradePrice(w, w.vehicles[0], part, "buy"),
    );
  });

  it("a 0 HP part buys back strictly above its sell price", () => {
    const w = startAtBowl();
    const part = makePart(w, "turbine", 0);
    part.hp = 0;
    expect(partTradePrice(w, w.vehicles[0], part, "buy")).toBeGreaterThan(
      partTradePrice(w, w.vehicles[0], part, "sell"),
    );
  });

  it("a half-HP part buys back strictly above its sell price", () => {
    const w = startAtBowl();
    const part = makePart(w, "turbine", 0);
    part.hp = Math.floor(maxHp(part) / 2);
    expect(partTradePrice(w, w.vehicles[0], part, "buy")).toBeGreaterThan(
      partTradePrice(w, w.vehicles[0], part, "sell"),
    );
  });

  it("buy price is strictly above sell price for every part def and wear step, at any Social level", () => {
    const w = startAtBowl();
    for (const social of [0, XP_TO_REACH[3]]) {
      w.player.skills.social = social;
      for (const defId of Object.keys(PARTS)) {
        for (let wear = 0; wear <= CONDITION.maxWear; wear++) {
          const part = makePart(w, defId, wear);
          for (const hpShare of [0, 0.5, 1]) {
            part.hp = Math.floor(maxHp(part) * hpShare);
            expect(partTradePrice(w, w.vehicles[0], part, "buy")).toBeGreaterThan(
              partTradePrice(w, w.vehicles[0], part, "sell"),
            );
          }
        }
      }
    }
  });

  it("repair cost scales with the part's value", () => {
    const w = startAtBowl();
    const mg = makePart(w, "mg", 0);
    const rack = makePart(w, "rocketRack", 0);
    mg.hp = 0;
    rack.hp = 0;
    expect(partRepairCost(w, rack)).toBeGreaterThan(partRepairCost(w, mg));
    expect(partDef(rack.defId).value).toBeGreaterThan(partDef(mg.defId).value);
  });

  it("rebuild cost at 0 HP pays the full repair share of value", () => {
    const w = startAtBowl();
    const part = makePart(w, "mg", 0);
    part.hp = 0;
    expect(partRepairCost(w, part)).toBe(
      Math.ceil(ECONOMY.repairShare * partValue(part)),
    );
  });

  it("refuses to price a rebuild for a junk part", () => {
    const w = startAtBowl();
    const part = makePart(w, "mg", 0);
    part.hp = 0;
    part.wear = CONDITION.maxWear + 1;
    expect(() => partRepairCost(w, part)).toThrow(/junk/);
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

  it("toughness cuts use", () => {
    const w = emptyWorld();
    const heat = heatAt(w, w.vehicles[0].pos);
    w.player.skills.toughness = XP_TO_REACH[2];
    const before = w.player.supplies;
    consumeSupplies(w);
    expect(before - w.player.supplies).toBeLessThan(RULES.suppliesPerTurn * heat);
  });
});

describe("locations", () => {
  it("oasis refills supplies", () => {
    const oasis = REGION.locations.find((l) => l.kind === "oasis")!;
    const w = emptyWorld({ ...sitePads(oasis)[0] });
    w.player.supplies = 1;
    const after = useOasis(w);
    expect(after.player.supplies).toBe(RULES.suppliesCap);
    expect(w.player.supplies).toBe(1);
  });

  it.each(REGION.locations.filter((site) => site.kind === "oasis"))("$name does not refill automatically", (oasis) => {
    const w = emptyWorld({ x: oasis.pos.x + 2, y: oasis.pos.y });
    w.player.supplies = 10;
    const after = endTurn(w, () => {});
    expect(after.player.supplies).toBeLessThanOrEqual(10);
  });

  it("requires stopping before refilling at an oasis", () => {
    const oasis = REGION.locations.find((site) => site.kind === "oasis")!;
    const w = emptyWorld({ ...sitePads(oasis)[0] });
    w.player.supplies = 1;
    w.vehicles[0].speed = RULES.parkedSpeed + 1;
    expect(() => useOasis(w)).toThrow("Stop the truck first");
    expect(w.player.supplies).toBe(1);
  });

  it.each(REGION.locations.filter((site) => site.kind === "oasis"))("interacts with $name only while stopped", (oasis) => {
    const w = emptyWorld({ ...sitePads(oasis)[0] });
    w.player.supplies = 1;
    w.vehicles[0].speed = RULES.parkedSpeed + 1;
    expect(applySiteAction(w)).toBeNull();
    expect(w.player.supplies).toBe(1);
    w.vehicles[0].speed = 0;
    const after = applySiteAction(w);
    expect(after?.player.supplies).toBe(RULES.suppliesCap);
    expect(after?.events).toContainEqual({ t: "info", text: `Filled supplies at ${oasis.name}` });
  });

  it("rejects refilling away from an oasis", () => {
    const w = emptyWorld({ x: 0, y: 0 });
    expect(() => useOasis(w)).toThrow("Not at an oasis");
  });

  it("convoy starts a timed search, and a second search cannot start while it runs", () => {
    const convoy = REGION.locations.find((l) => l.kind === "convoy")!;
    const w = emptyWorld({ ...sitePads(convoy)[0] });
    const after = scavenge(w);
    expect(after.vehicles[0].job).toEqual(
      expect.objectContaining({ kind: "search", stockId: convoy.id }),
    );
    expect(() => scavenge(after)).toThrow();
  });

  it("a town in reach needs a stop before it can be used", () => {
    const gate = sitePads(REGION.towns[0])[0];
    const w = emptyWorld({ ...gate });
    w.vehicles[0].speed = RULES.parkedSpeed + 1;
    expect(townAt(w)).toBeNull();
    expect(townNear(w)?.id).toBe(REGION.towns[0].id);
  });

  it("salvage in range needs a stop before it can be searched", () => {
    const convoy = REGION.locations.find((l) => l.kind === "convoy")!;
    const w = emptyWorld({ ...sitePads(convoy)[0] });
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
    w = endTurn(w, testDrive);
    expect(w.player.discovered).toContain("burnt-convoy");
    expect(
      w.events.filter((e) => e.t === "discover" && e.location === convoy.id),
    ).toHaveLength(1);
    w = endTurn(w, testDrive);
    expect(
      w.events.filter((e) => e.t === "discover" && e.location === convoy.id),
    ).toHaveLength(0);
  });
});

describe("debt", () => {
  it("a player in debt cannot buy anything", () => {
    const w = startAtBowl();
    w.player.money = -100;
    w.player.fuel = CHASSIS.scout.fuelCap - 1;
    expect(() => buyGood(w, "scrap", 1)).toThrow(/money/);
    expect(() => buySupply(w, "fuel", 1)).toThrow(/money/);
    expect(() => buyStockPart(w, w.shops.bowl.stock[0].id)).toThrow(/money/);
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
    const npc = addVehicle(w, "traders", "hauler", ["stockEngine"], { ...sitePads(bowl)[0] });
    npc.resources!.money = -50;
    npc.resources!.fuel = 1;
    npc.resources!.supplies = 1;
    const engine = mountedParts(npc, "engine")[0];
    engine.hp = 1;
    serviceVehicle(w, npc, "bowl", 0);
    expect(npc.resources).toMatchObject({ money: -50, fuel: 1, supplies: 1 });
    expect(engine.hp).toBe(1);
  });
});
