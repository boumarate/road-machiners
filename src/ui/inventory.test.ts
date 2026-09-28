import { describe, expect, it } from "vitest";
import { GOOD_IDS } from "../data/goods";
import { getItemIcon } from "./inventory";

describe("inventory artwork for current trade goods", () => {
  it.each(GOOD_IDS)("provides an icon for %s", (good) => {
    expect(
      getItemIcon({ id: good, kind: "good", good, x: 0, y: 0, rot: 0 }),
    ).toBe(good);
  });
});
