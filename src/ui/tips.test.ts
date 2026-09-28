import { describe, expect, it } from "vitest";
import { playerVehicle } from "../sim/damage";
import { addVehicle, emptyWorld, npcBrain } from "../sim/testkit";
import { refreshVision } from "../sim/vision";
import { doneTips, tipToShow, type TipId } from "./tips";

describe("driving tips", () => {
  it("walks the player from a waypoint to Space, stopping and manual mode", () => {
    const w = emptyWorld();
    const me = playerVehicle(w);
    const seen = new Set<TipId>();
    expect(tipToShow(w, seen, null)).toBe("waypoint");

    me.order = { kind: "through", dest: { x: 40, y: 30 } };
    seen.add("waypoint");
    expect(tipToShow(w, seen, null)).toBe("drive");

    me.speed = 2;
    seen.add("drive");
    expect(tipToShow(w, seen, null)).toBe("stop");

    me.speed = 0;
    me.order = { kind: "brake" };
    seen.add("stop");
    expect(tipToShow(w, seen, null)).toBe("manual");

    me.direct = true;
    seen.add("manual");
    expect(tipToShow(w, seen, null)).toBe("zones");
  });

  it("holds a later driving tip until the one before it is seen", () => {
    const w = emptyWorld();
    playerVehicle(w).speed = 2;
    expect(tipToShow(w, new Set(), null)).toBe("waypoint");
  });

  it("marks tips done by what the player did", () => {
    const w = emptyWorld();
    const me = playerVehicle(w);
    me.order = { kind: "brake" };
    me.direct = true;
    w.events.push({ t: "honk", vehicle: me.id });
    expect(doneTips(w).sort()).toEqual(["honk", "manual", "stop"]);
  });

  it("shows no tip to a player who cannot act", () => {
    const w = emptyWorld();
    w.player.state = "dead";
    expect(tipToShow(w, new Set(), null)).toBeNull();
  });
});

describe("horn tip", () => {
  it("shows once an NPC is in sight and keeps a shown tip in place", () => {
    const w = emptyWorld();
    const seen = new Set<TipId>(["waypoint", "drive", "stop", "manual"]);
    expect(tipToShow(w, seen, null)).toBeNull();

    const npc = addVehicle(w, "scavengers", "scout", [], { x: 32, y: 30 });
    npc.brain = npcBrain("scavenger", npc.pos, ["scavenger"]);
    refreshVision(w);
    expect(tipToShow(w, seen, null)).toBe("honk");

    const driving = new Set<TipId>();
    expect(tipToShow(w, driving, "waypoint")).toBe("waypoint");
  });

  it("ignores an NPC out of sight", () => {
    const w = emptyWorld();
    const npc = addVehicle(w, "scavengers", "scout", [], { x: 58, y: 58 });
    npc.brain = npcBrain("scavenger", npc.pos, ["scavenger"]);
    refreshVision(w);
    expect(tipToShow(w, new Set(["waypoint"]), null)).toBeNull();
  });
});
