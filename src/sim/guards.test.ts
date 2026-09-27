import { describe, expect, it } from "vitest";
import { REGION } from "../data/region";
import { RULES } from "../data/rules";
import { fireWeapons } from "./combat";
import { mountedParts } from "./grid";
import { fireGuards } from "./guards";
import { siteGates } from "./sites";
import { addVehicle, emptyWorld } from "./testkit";
import type { Vec } from "./vec";

const bowl = REGION.towns.find((t) => t.id === "bowl")!;
const gate = siteGates(bowl)[0];
// A point `d` tiles out from the gate, away from the town.
function outside(d: number): Vec {
  return {
    x: gate.x + ((gate.x - bowl.pos.x) / bowl.radius) * d,
    y: gate.y + ((gate.y - bowl.pos.y) / bowl.radius) * d,
  };
}

function raiderFiringAt(at: Vec) {
  const w = emptyWorld(outside(2));
  const victim = addVehicle(w, "traders", "hauler", [], {
    x: at.x + 1.5,
    y: at.y,
  });
  const raider = addVehicle(w, "raiders", "buggy", ["mg"], at);
  raider.weaponOrders[mountedParts(raider, "weapon")[0].id] = {
    targetId: victim.id,
    aim: "body",
  };
  return { w, raider, victim };
}

describe("town guards", () => {
  it("extends the gate gun range to twelve tiles", () => {
    expect(RULES.guards.range).toBe(12);
  });

  it("shoot a vehicle that fires within the extended gate range", () => {
    const { w, raider } = raiderFiringAt(outside(10));
    fireWeapons(w);
    fireGuards(w);
    const shots = w.events.filter((e) => e.t === "guardShot");
    expect(shots.map((e) => e.t === "guardShot" && e.target)).toEqual([
      raider.id,
    ]);
    const rounds = shots[0].t === "guardShot" ? shots[0].rounds : [];
    expect(rounds).toHaveLength(RULES.guards.rounds);
  });

  it("leave alone vehicles that do not fire, and fights out of range", () => {
    const near = raiderFiringAt(outside(3));
    near.raider.weaponOrders = {};
    fireWeapons(near.w);
    fireGuards(near.w);
    expect(near.w.events.some((e) => e.t === "guardShot")).toBe(false);
    const far = raiderFiringAt(outside(RULES.guards.range + 2));
    fireWeapons(far.w);
    expect(far.w.events.some((e) => e.t === "shot")).toBe(true);
    fireGuards(far.w);
    expect(far.w.events.some((e) => e.t === "guardShot")).toBe(false);
  });
});

