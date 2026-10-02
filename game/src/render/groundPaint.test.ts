import { describe, expect, it } from "vitest";
import type { TerrainTypeId } from "../data/terrain";
import { desertWeight } from "./groundPaint";

describe("desertWeight", () => {
  it("keeps farmland, old highways and pools out of the warm patches", () => {
    const kept: TerrainTypeId[] = ["field", "asphalt", "ash", "saltCrust", "mud", "dirtyWater", "toxic"];
    for (const type of kept) expect(desertWeight(type), type).toBe(0);
  });

  it("warms open desert ground, hardpan the most", () => {
    expect(desertWeight("hardpan")).toBe(1);
    for (const type of ["sand", "scrub", "gravel", "scree"] as const) {
      expect(desertWeight(type), type).toBeGreaterThan(0);
      expect(desertWeight(type), type).toBeLessThan(1);
    }
  });

  it("weighs road tiles like the hardpan they paint as", () => {
    expect(desertWeight("road")).toBe(desertWeight("hardpan"));
  });
});
