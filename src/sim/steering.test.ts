import { RULES } from "../data/rules";
import { describe, expect, it } from "vitest";
import { vehicleStats } from "./stats";
import { clickOrder, throttleFor, zoneEdges, zoneSpeed } from "./steering";
import { emptyWorld } from "./testkit";

function setup(speed: number) {
  const w = emptyWorld();
  const v = w.vehicles[0];
  v.speed = speed;
  return { w, v, s: vehicleStats(w, v) };
}

describe("throttle by click distance", () => {
  it("zones span their reach: brake 25%, hold 50%, accelerate 25%", () => {
    const z = zoneEdges();
    expect(z.reach).toBeCloseTo(RULES.throttleZones.reach);
    expect(z.brakeEnd).toBeCloseTo(z.reach * 0.25);
    expect(z.holdEnd - z.brakeEnd).toBeCloseTo(z.reach * 0.5);
  });

  it("a close click brakes, a mid click holds, a far click accelerates", () => {
    const { s } = setup(4);
    const z = zoneEdges();
    const at = (d: number) => zoneSpeed(s, 4, d);
    expect(at(0.01)).toBeCloseTo(4 - s.brake, 1);
    expect(at(z.brakeEnd / 2)).toBeCloseTo(4 - s.brake / 2, 5);
    expect(at((z.brakeEnd + z.holdEnd) / 2)).toBe(4);
    expect(at(z.reach + 5)).toBe(Math.min(s.maxSpeed, 4 + s.accel));
    expect(throttleFor(1, 4)).toBe("brake");
    // Braking for a close point stops at the speed from rest.
    expect(zoneSpeed(s, 0.5, 1)).toBeCloseTo(zoneSpeed(s, 0, 1), 5);
    expect(throttleFor(5, 4)).toBe("hold");
    expect(throttleFor(20, 4)).toBe("accelerate");
  });
});

describe("click orders", () => {
  it("at rest the red zone is one third of reach and green is two thirds", () => {
    const z = zoneEdges();
    expect(throttleFor(z.reach / 3 - 0.01, 0)).toBe("brake");
    expect(throttleFor(z.reach / 3 + 0.01, 0)).toBe("accelerate");
  });

  it("a nearby ground click remains a destination", () => {
    expect(clickOrder({ x: 31, y: 30 }, false, { pos: { x: 1, y: 1 }, order: null })).toEqual({ kind: "through", dest: { x: 31, y: 30 } });
    expect(clickOrder({ x: 36, y: 30 }, false, { pos: { x: 1, y: 1 }, order: null }).kind).toBe("through");
    expect(clickOrder({ x: 31, y: 30 }, true, { pos: { x: 1, y: 1 }, order: null }).kind).toBe("stopAt");
  });

  it("a click on the order's point switches it between driving through and stopping", () => {
    const dest = { x: 31, y: 30 };
    const near = { x: 31 + RULES.reclickRadius / 2, y: 30 };
    const stop = clickOrder(near, false, { pos: { x: 1, y: 1 }, order: { kind: "through", dest } });
    expect(stop).toEqual({ kind: "stopAt", dest });
    expect(clickOrder(near, false, { pos: { x: 1, y: 1 }, order: stop })).toEqual({ kind: "through", dest });
  });

  it("a click away from the order's point sets a new drive-through point", () => {
    const far = { x: 31 + RULES.reclickRadius * 2, y: 30 };
    expect(clickOrder(far, false, { pos: { x: 1, y: 1 }, order: { kind: "stopAt", dest: { x: 31, y: 30 } } })).toEqual({ kind: "through", dest: far });
    expect(clickOrder(far, false, { pos: { x: 1, y: 1 }, order: { kind: "brake" } })).toEqual({ kind: "through", dest: far });
  });
});
