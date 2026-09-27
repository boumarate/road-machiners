import { describe, expect, it } from "vitest";
import { PHYSICS } from "../../data/physics";
import type { Terrain } from "../../sim/terrain";
import { emptyWorld } from "../../sim/testkit";
import { PathView } from "./path";

const terrain: Terrain = { size: 2, heights: Array(9).fill(0), types: Array(4).fill("road") };

describe("waypoint marker", () => {
  it("remains at the destination while the preview is hidden and cleared", () => {
    const path = new PathView(terrain);
    const before = emptyWorld({ x: 1, y: 1 });
    before.vehicles[0].order = { kind: "stopAt", dest: { x: 1, y: 1 } };
    path.updateVisibility(false, { before }, false);
    path.clear();

    expect(path.root.visible).toBe(false);
    expect(path.waypoint.visible).toBe(true);
    expect(path.waypoint.position.x).toBe(PHYSICS.metersPerTile);
    expect(path.waypoint.position.z).toBe(PHYSICS.metersPerTile);

    path.updateVisibility(true, null, false);
    expect(path.waypoint.visible).toBe(false);
  });
});
