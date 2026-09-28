import { describe, expect, it } from "vitest";
import { START_KITS } from "../data/start";
import { mountedParts } from "../sim/grid";
import { playerVehicle } from "../sim/damage";
import { newWorld } from "../sim/world";
import type { PartInstance } from "../sim/types";
import { partValue } from "../sim/wear";
import { baselinePart, chassisStats, comparePart, diffStats, partStats } from "./cards";

const part = (defId: string, wear = 0): PartInstance => ({ id: defId, defId, hp: 1, wear, reload: 0 });

describe("part stats and their change against the player's part", () => {
  it("marks a faster engine better and its higher fuel use worse", () => {
    const diffs = diffStats(partStats(part("turbine")), partStats(part("stockEngine")));
    const byIcon = Object.fromEntries(diffs.map((d) => [d.stat.icon, d.delta === null ? null : d.verdict]));
    expect(byIcon.speed).toBe("better");
    expect(byIcon.fuel).toBe("worse");
  });

  it("marks lower mass better, since less is the better side", () => {
    const [light, heavy] = [part("ceramicTile"), part("steelPlate")];
    const mass = diffStats(partStats(light), partStats(heavy)).find((d) => d.stat.icon === "mass");
    expect(mass).toMatchObject({ verdict: "better" });
  });

  it("gives no change without a part to compare with", () => {
    expect(diffStats(partStats(part("turbine")), null).every((d) => d.delta === null)).toBe(true);
  });

  it("shows worn stats, so a rebuilt engine reads slower than a pristine one", () => {
    const speed = (p: PartInstance) => partStats(p).find((s) => s.icon === "speed")?.value;
    expect(speed(part("turbine", 2))).toBeLessThan(speed(part("turbine")) ?? 0);
  });

  it("compares trucks stat by stat", () => {
    const speed = diffStats(chassisStats("courier"), chassisStats("hauler")).find((d) => d.stat.icon === "speed");
    expect(speed).toMatchObject({ verdict: "better" });
  });
});

describe("the part a new part is weighed against", () => {
  it("is the most valuable mounted part of the same kind", () => {
    const me = playerVehicle(newWorld(1, START_KITS.standard));
    const engines = mountedParts(me, "engine");
    expect(baselinePart(me, "engine")).toBe(engines[0]);
    expect(baselinePart(me, "scanner")).toBeNull();
  });
});

describe("the part a shop card compares with", () => {
  it("steps through the mounted parts of the kind, most valuable first, and wraps", () => {
    const w = newWorld(1, START_KITS.combat);
    const me = playerVehicle(w);
    const guns = [...mountedParts(me, "weapon")].sort((a, b) => partValue(b) - partValue(a));
    expect(guns.length).toBeGreaterThan(1);
    expect(comparePart(me, "weapon", 0)).toBe(guns[0]);
    expect(comparePart(me, "weapon", 1)).toBe(guns[1]);
    expect(comparePart(me, "weapon", guns.length)).toBe(guns[0]);
  });

  it("has nothing to compare with when no part of the kind is mounted", () => {
    const me = playerVehicle(newWorld(1, START_KITS.standard));
    expect(comparePart(me, "scanner", 0)).toBeNull();
  });
});
