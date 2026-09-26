import { RULES } from "../data/rules";
import { describe, expect, it } from "vitest";
import { maxTurn, vehicleStats } from "./stats";
import {
  advance,
  clickOrder,
  planPath,
  steerStep,
  steerTo,
  throttleFor,
  zoneEdges,
} from "./steering";
import { TERRAIN } from "../data/terrain";
import { emptyWorld } from "./testkit";
import { endTurn, setMoveOrder } from "./world";
import { angleDiff, dist } from "./vec";

function setup(speed: number) {
  const w = emptyWorld();
  const v = w.vehicles[0];
  v.speed = speed;
  return { w, v, s: vehicleStats(w, v) };
}

describe("steerStep", () => {
  it("changes speed by at most accel or brake", () => {
    const { w, v, s } = setup(2);
    const far = steerStep(
      s,
      v,
      { x: 60, y: 30 },
      dist(v.pos, { x: 60, y: 30 }),
    );
    expect(far.speed).toBeLessThanOrEqual(2 + s.accel);
    const behind = steerStep(
      s,
      { ...v, speed: 6 },
      { x: 0, y: 30 },
      dist(v.pos, { x: 0, y: 30 }),
    );
    expect(behind.speed).toBeGreaterThanOrEqual(6 - s.brake);
  });

  it("turns no more than the limit for the chosen speed", () => {
    const { w, v, s } = setup(4);
    const st = steerStep(s, v, { x: 30, y: 50 }, dist(v.pos, { x: 30, y: 50 }));
    expect(Math.abs(st.turn)).toBeLessThanOrEqual(maxTurn(s, st.speed) + 1e-9);
  });

  it("allows sharper turns at lower speed", () => {
    const { s } = setup(0);
    expect(maxTurn(s, 1)).toBeGreaterThan(maxTurn(s, s.maxSpeed));
  });

  it("turns only a little when starting from a standstill", () => {
    const { v, s } = setup(0);
    const st = steerStep(
      s,
      v,
      { x: 29.2, y: 30.3 },
      dist(v.pos, { x: 29.2, y: 30.3 }),
    );
    expect(Math.abs(st.turn)).toBeLessThanOrEqual(maxTurn(s, st.speed) + 1e-9);
    expect(Math.abs(st.turn)).toBeLessThan(s.turnSlow);
    expect(maxTurn(s, 0)).toBe(0);
  });

  it("brakes with no destination", () => {
    const { w, v, s } = setup(5);
    expect(steerStep(s, v, null, 0)).toEqual({ speed: 5 - s.brake, turn: 0 });
  });
});

describe("planPath", () => {
  it("reaches a point straight ahead and stops there", () => {
    const { w, v, s } = setup(0);
    const plan = planPath(
      w,
      s,
      v,
      { kind: "stopAt", dest: { x: 45, y: 30 } },
      20,
    );
    expect(plan.some((p) => p.arrives)).toBe(true);
  });

  it("reaches a point behind itself without orbiting", () => {
    for (const d of [1.5, 3, 8]) {
      const { w, v, s } = setup(4);
      const target = { x: 30 - d, y: 30 };
      const plan = planPath(w, s, v, { kind: "stopAt", dest: target }, 30);
      expect(
        plan.some((p) => p.arrives),
        `distance ${d}`,
      ).toBe(true);
    }
  });

  it("cannot U-turn in one turn", () => {
    const { w, v, s } = setup(4);
    const plan = planPath(
      w,
      s,
      v,
      { kind: "through", dest: { x: 20, y: 30 } },
      1,
    );
    expect(Math.abs(angleDiff(0, plan[0].end.heading))).toBeLessThan(
      Math.PI * 0.9,
    );
    expect(dist(plan[0].end, { x: 20, y: 30 })).toBeGreaterThan(5);
  });
});

describe("momentum", () => {
  it("coasts at the same speed and heading with no order", () => {
    const { w, v, s } = setup(4);
    expect(steerTo(w, s, v, null, false)).toEqual({ speed: 4, turn: 0 });
  });

  it("keeps pace through a drive-through point and coasts on after it", () => {
    const { w, v, s } = setup(5);
    const plan = planPath(
      w,
      s,
      v,
      { kind: "through", dest: { x: 38, y: 30 } },
      4,
    );
    expect(plan[0].arrives || plan[1].arrives).toBe(true);
    const last = plan[plan.length - 1];
    expect(dist(last.end, { x: 30, y: 30 })).toBeGreaterThan(12);
  });

  it("brakes by at most the brake rate", () => {
    const { w, v, s } = setup(5);
    expect(steerTo(w, s, v, { kind: "brake" }, false).speed).toBe(5 - s.brake);
  });

  it("a stop order ends at rest on the point", () => {
    const { w, v, s } = setup(5);
    const plan = planPath(
      w,
      s,
      v,
      { kind: "stopAt", dest: { x: 45, y: 30 } },
      10,
    );
    expect(plan.some((p) => p.arrives)).toBe(true);
    expect(dist(plan.at(-1)!.end, { x: 45, y: 30 })).toBeLessThan(
      RULES.arriveRadius + s.brake,
    );
  });
});

describe("throttle by click distance", () => {
  it("zones span all of vision: brake 25%, hold 50%, accelerate 25%", () => {
    const z = zoneEdges();
    expect(z.reach).toBeCloseTo(TERRAIN.vision.radius);
    expect(z.brakeEnd).toBeCloseTo(z.reach * 0.25);
    expect(z.holdEnd - z.brakeEnd).toBeCloseTo(z.reach * 0.5);
  });

  it("a close click brakes, a mid click holds, a far click accelerates", () => {
    const { w, v, s } = setup(4);
    const z = zoneEdges();
    const at = (d: number) =>
      steerTo(w, s, v, { kind: "through", dest: { x: 30 + d, y: 30 } }, false)
        .speed;
    expect(at(0.01)).toBeCloseTo(4 - s.brake, 1);
    expect(at(z.brakeEnd / 2)).toBeCloseTo(4 - s.brake / 2, 5);
    expect(at((z.brakeEnd + z.holdEnd) / 2)).toBe(4);
    expect(at(z.reach + 5)).toBe(Math.min(s.maxSpeed, 4 + s.accel));
    expect(throttleFor(1, 4)).toBe("brake");
    expect(throttleFor(5, 4)).toBe("hold");
    expect(throttleFor(20, 4)).toBe("accelerate");
  });

  it("a slight turn at speed keeps the speed", () => {
    const { w, v, s } = setup(5);
    const st = steerTo(
      w,
      s,
      v,
      { kind: "through", dest: { x: 34, y: 31 } },
      false,
    );
    expect(st.speed).toBe(5);
    expect(st.turn).toBeGreaterThan(0);
  });
});

describe("curve direction", () => {
  it("on open ground a click to one side always bends that way", () => {
    const { w, v, s } = setup(4);
    for (const h of [0, 1, 2, 3, 4, 5]) {
      for (const side of [-0.8, -0.3, 0.3, 0.8]) {
        v.heading = h;
        const dest = {
          x: 30 + Math.cos(h + side) * 5,
          y: 30 + Math.sin(h + side) * 5,
        };
        expect(
          Math.sign(steerTo(w, s, v, { kind: "through", dest }, false).turn),
        ).toBe(Math.sign(side));
      }
    }
  });

  it("bends around a rock only when this turn would hit it", () => {
    const { w, v, s } = setup(4);
    w.obstacles = [{ id: "r", pos: { x: 33, y: 30.4 }, r: 0.8, kind: "rock" }];
    const st = steerTo(
      w,
      s,
      v,
      { kind: "through", dest: { x: 36, y: 30.5 } },
      false,
    );
    let p = { x: 30, y: 30, heading: 0 };
    for (let i = 0; i < 20; i++) {
      p = advance(p, st, 20);
      expect(dist(p, w.obstacles[0].pos)).toBeGreaterThan(0.8 + s.radius);
    }
  });
});

describe("backing up", () => {
  const far = { x: 20, y: 30 }; // behind the truck, in the accelerate zone

  it("a stopped truck facing away backs toward the click", () => {
    const { w, v, s } = setup(0);
    const st = steerTo(
      w,
      s,
      v,
      { kind: "through", dest: { x: 20, y: 31 } },
      false,
    );
    expect(st.speed).toBe(-RULES.reverse.distance);
    expect(st.turn).toBeLessThan(0);
    const end = advance({ x: 30, y: 30, heading: 0 }, st, 1);
    expect(end.x).toBeLessThan(30);
  });

  it("never turns without moving", () => {
    const { w, v, s } = setup(0);
    for (const dest of [far, { x: 30, y: 40 }, { x: 38, y: 33 }]) {
      const st = steerTo(w, s, v, { kind: "through", dest }, false);
      if (st.speed === 0) expect(st.turn).toBe(0);
    }
  });

  it("backs toward a nearby point behind it", () => {
    const { w, v, s } = setup(0);
    const dest = { x: 28, y: 30.5 };
    const st = steerTo(w, s, v, clickOrder(v, dest, false), false);
    const end = advance({ x: 30, y: 30, heading: 0 }, st, 1);
    expect(st.speed).toBeLessThan(0);
    expect(end.x).toBeLessThan(30);
    expect(end.y).toBeGreaterThan(30);
    expect(dist(end, dest)).toBeLessThan(dist(v.pos, dest));
  });

  it("moves slowly toward a nearby point from rest", () => {
    const { w, v, s } = setup(0);
    const dest = { x: 31, y: 30 };
    const st = steerTo(w, s, v, clickOrder(v, dest, false), false);
    expect(st.speed).toBeGreaterThan(0);
    expect(st.speed).toBeLessThan(s.accel);
    expect(st.speed).toBeLessThan(dist(v.pos, dest));
  });

  it("stays still when clicked at its own position", () => {
    const { w, v, s } = setup(0);
    expect(steerTo(w, s, v, clickOrder(v, v.pos, false), false)).toEqual({
      speed: 0,
      turn: 0,
    });
  });

  it("a moving truck does not back up", () => {
    const { w, v, s } = setup(4);
    expect(
      steerTo(w, s, v, { kind: "through", dest: far }, false).speed,
    ).toBeGreaterThan(0);
  });

  it("does not back into a rock", () => {
    const { w, v, s } = setup(0);
    w.obstacles = [{ id: "r", pos: { x: 28.8, y: 30 }, r: 0.5, kind: "rock" }];
    expect(
      steerTo(w, s, v, { kind: "through", dest: { x: 20, y: 31 } }, false)
        .speed,
    ).toBeGreaterThanOrEqual(0);
  });

  it("backing up does not count as passing the point and ends at rest", () => {
    const { w, v, s } = setup(0);
    const plan = planPath(w, s, v, { kind: "through", dest: far }, 2);
    expect(plan[0].arrives).toBe(false);
    expect(plan[0].end.x).toBeLessThan(30);
  });

  it("a truck stopped near a rock backs toward a nearby click behind it", () => {
    let w = emptyWorld();
    w.obstacles = [{ id: "r", pos: { x: 31.5, y: 30 }, r: 0.8, kind: "rock" }];
    const dest = { x: 28, y: 30.5 };
    w = setMoveOrder(w, clickOrder(w.vehicles[0], dest, false));
    w = endTurn(w);
    expect(w.events.filter((e) => e.t === "collision")).toHaveLength(0);
    expect(w.vehicles[0].pos.x).toBeLessThan(30);
    expect(w.vehicles[0].pos.y).toBeGreaterThan(30);
    expect(dist(w.vehicles[0].pos, dest)).toBeLessThan(
      dist({ x: 30, y: 30 }, dest),
    );
  });

  it("a truck stopped against a rock backs out and drives to a click behind it", () => {
    let w = emptyWorld();
    w.obstacles = [{ id: "r", pos: { x: 31.5, y: 30 }, r: 0.8, kind: "rock" }];
    w = setMoveOrder(w, { kind: "through", dest: { x: 18, y: 31 } });
    let hits = 0;
    for (let i = 0; i < 8; i++) {
      w = endTurn(w);
      hits += w.events.filter((e) => e.t === "collision").length;
    }
    expect(hits).toBe(0);
    expect(w.vehicles[0].pos.x).toBeLessThan(26);
  });
});

describe("click orders", () => {
  it("at rest the red zone is one third of reach and green is two thirds", () => {
    const z = zoneEdges();
    expect(throttleFor(z.reach / 3 - 0.01, 0)).toBe("brake");
    expect(throttleFor(z.reach / 3 + 0.01, 0)).toBe("accelerate");
  });

  it("above a small speed a brake zone click stops; slower it eases", () => {
    const v = { pos: { x: 30, y: 30 }, speed: RULES.stopClickSpeed + 1 };
    expect(clickOrder(v, { x: 31, y: 30 }, false)).toEqual({ kind: "brake" });
    expect(
      clickOrder({ ...v, speed: RULES.stopClickSpeed }, { x: 31, y: 30 }, false)
        .kind,
    ).toBe("through");
    expect(clickOrder(v, { x: 36, y: 30 }, false).kind).toBe("through");
    expect(clickOrder(v, { x: 31, y: 30 }, true).kind).toBe("stopAt");
  });
});
