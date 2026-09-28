import { describe, expect, it } from "vitest";
import { GOOD_IDS } from "../data/goods";
import { partDef, type WeaponDef } from "../data/parts";
import { makePart } from "../sim/factory";
import { addVehicle, emptyWorld } from "../sim/testkit";
import type { GridItem } from "../sim/types";
import { fireText, getItemIcon } from "./inventory";

describe("inventory artwork for current trade goods", () => {
  it.each(GOOD_IDS)("provides an icon for %s", (good) => {
    expect(
      getItemIcon({ id: good, kind: "good", good, x: 0, y: 0, rot: 0 }),
    ).toBe(good);
  });
});

describe("where a mounted gun can fire, in words", () => {
  function gunAt(chassisId: string, defId: string, x: number, y: number) {
    const w = emptyWorld();
    const v = addVehicle(w, "player", chassisId, ["stockEngine"], { x: 40, y: 40 });
    const it: GridItem = { id: "i-gun", x, y, rot: 0, kind: "part", part: makePart(w, defId, 0) };
    v.items.push(it);
    return { v, it, def: partDef(defId) as WeaponDef };
  }

  it("names the cab that blocks a bed gun in front", () => {
    const { v, it, def } = gunAt("scout", "mg", 2, 5);
    expect(fireText(v, it, def)).toBe("Fires back and to the sides. The cab blocks the front.");
  });

  it("says a hood gun fires forward and to the sides", () => {
    const { v, it, def } = gunAt("scout", "mg", 3, 1);
    expect(fireText(v, it, def)).toBe("Fires forward and to the sides. The cab blocks the back.");
  });

  it("says a forward gun with a clear front fires in its arc", () => {
    const { v, it, def } = gunAt("hauler", "cannon", 1, 3);
    expect(fireText(v, it, def)).toBe("Fires forward in a 60° arc.");
  });

  it("says a forward gun behind the cab cannot fire", () => {
    const { v, it, def } = gunAt("longbed", "cannon", 1, 5);
    expect(fireText(v, it, def)).toBe("Cannot fire. The cab blocks the front.");
  });
});
