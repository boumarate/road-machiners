import { describe, expect, it } from "vitest";
import { corePart, coreParts, mountedParts, mountedItems, itemSize } from "../sim/grid";
import { emptyWorld } from "../sim/testkit";
import { conditionLabel, TruckConditionReadout } from "./hud-readout";

describe("truck condition", () => {
  it("keeps critical parts at their actual chassis positions", () => {
    const vehicle = emptyWorld().vehicles[0];
    const parts = new TruckConditionReadout().update(vehicle);
    expect(parts).toHaveLength(9);
    expect(parts.filter((part) => part.icon === "wheel")).toHaveLength(4);
    for (const part of parts) {
      const item = mountedItems(vehicle).find((item) => item.part.id === part.id);
      if (!item) throw new Error("Missing mounted part");
      expect(part).toMatchObject({ x: item.x, y: item.y, ...itemSize(item), percent: 100, hit: false });
    }
    expect(parts.map((part) => part.icon)).not.toContain("cargo");
    expect(parts.map((part) => part.icon)).not.toContain("armor");
  });

  it("flashes only on a new health loss, not initial damage, repair or redraw", () => {
    const vehicle = emptyWorld().vehicles[0];
    const engine = mountedParts(vehicle, "engine")[0];
    engine.hp = 20;
    const readout = new TruckConditionReadout();
    expect(readout.update(vehicle).find((part) => part.id === engine.id)).toMatchObject({ percent: 40, hit: false });
    engine.hp = 10;
    expect(readout.update(vehicle).find((part) => part.id === engine.id)).toMatchObject({ percent: 20, state: "critical", hit: true });
    expect(readout.update(vehicle).some((part) => part.hit)).toBe(false);
    engine.hp = 30;
    expect(readout.update(vehicle).find((part) => part.id === engine.id)).toMatchObject({ percent: 60, state: "damaged", hit: false });
  });

  it("shows each broken wheel separately and never rounds a working part to zero", () => {
    const vehicle = emptyWorld().vehicles[0];
    const wheels = coreParts(vehicle, "wheel");
    wheels[0].hp = 0;
    corePart(vehicle, "cab").hp = 0.01;
    const parts = new TruckConditionReadout().update(vehicle);
    expect(parts.find((part) => part.id === wheels[0].id)).toMatchObject({ percent: 0, state: "critical" });
    expect(parts.filter((part) => part.icon === "wheel" && part.percent === 100)).toHaveLength(3);
    expect(parts.find((part) => part.icon === "cab")?.percent).toBe(1);
  });

  it("resets damage history when changing truck and excludes unmounted equipment", () => {
    const vehicle = emptyWorld().vehicles[0];
    const readout = new TruckConditionReadout();
    readout.update(vehicle);
    vehicle.id = "replacement";
    corePart(vehicle, "cab").hp = 1;
    expect(readout.update(vehicle).some((part) => part.hit)).toBe(false);
    const engine = mountedItems(vehicle, "engine")[0];
    engine.y = 20;
    expect(readout.update(vehicle).some((part) => part.id === engine.part.id)).toBe(false);
  });
});

describe("condition tooltip", () => {
  it("names the part with its condition", () => {
    expect(conditionLabel({ name: "Stock engine", percent: 40 })).toBe("Stock engine: 40%");
  });

  it("marks a broken part", () => {
    expect(conditionLabel({ name: "Cab", percent: 0 })).toBe("Cab: 0% (broken)");
  });

  it("gives every tile of a truck a name", () => {
    const parts = new TruckConditionReadout().update(emptyWorld().vehicles[0]);
    for (const part of parts) expect(conditionLabel(part).startsWith(`${part.name}:`)).toBe(true);
  });
});
