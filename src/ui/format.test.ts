import { describe, expect, it } from "vitest";
import { CONDITION } from "../data/wear";
import type { PartInstance } from "../sim/types";
import { wearLabel } from "./format";

function part(wear: number): PartInstance {
  return { id: "p1", defId: "mg", hp: 10, reload: 0, wear };
}

describe("wearLabel", () => {
  it("reads a wear-0 part as pristine", () => {
    expect(wearLabel(part(0))).toBe("pristine");
  });

  it("counts rebuilds for a part that has broken and been rebuilt before", () => {
    expect(wearLabel(part(1))).toBe("rebuilt x1");
    expect(wearLabel(part(2))).toBe("rebuilt x2");
  });

  it("reads a part past the last wear step as junk", () => {
    expect(wearLabel(part(CONDITION.maxWear + 1))).toBe("junk");
  });
});
