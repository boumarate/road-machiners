import { describe, expect, it } from "vitest";
import { CONDITION } from "../data/wear";
import type { Contract } from "../sim/market";
import { partDef } from "../data/parts";
import { addVehicle, emptyWorld, npcBrain } from "../sim/testkit";
import type { Job, PartInstance } from "../sim/types";
import { contractDue, contractSummary, jobLabel, wearLabel } from "./format";

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

describe("contract text", () => {
  const bounty: Contract = { id: "c1", shop: "bowl", kind: "bounty", template: "buggy", targetName: "Raider outrider", reward: 100, deadline: 100, tier: 1 };
  const fetch: Contract = { id: "c2", shop: "bowl", kind: "fetch", defId: "mg", reward: 100, deadline: 100, tier: 1 };

  it("shows the deadline as the game time the contract fails", () => {
    expect(contractDue(bounty)).toBe("by Day 1 15:00");
  });

  it("names any truck of the bounty's type", () => {
    expect(contractSummary(bounty)).toBe("defeat any Raider outrider");
  });

  it("says the hand-in part must still work and be rebuilt at most once", () => {
    expect(contractSummary(fetch)).toBe("find a MG turret anywhere, working and rebuilt at most once, bring it to Bowl");
  });
});

describe("jobLabel", () => {
  function downedBuggy() {
    const w = emptyWorld();
    const buggy = addVehicle(w, "raiders", "buggy", ["mg", "stockEngine"], { x: 33, y: 30 });
    buggy.brain = npcBrain("buggy", buggy.pos, ["raider"]);
    const gun = buggy.items.find((it) => it.kind === "part" && it.part.defId === "mg");
    if (gun?.kind !== "part") throw new Error("Expected a gun");
    return { w, me: w.vehicles[0], buggy, gun };
  }

  it("names the part and the truck of a removal, before and after it is done", () => {
    const { w, me, buggy, gun } = downedBuggy();
    const job: Job = { kind: "refit", moves: [], pickup: { from: "truck", vehicleId: buggy.id, partId: gun.part.id, itemId: "new", to: { x: 0, y: 0, rot: 0 } }, turnsLeft: 3, total: 3 };
    expect(jobLabel(w, me, job)).toBe(`Remove ${partDef("mg").name} from ${buggy.name}`);
    buggy.items = buggy.items.filter((it) => it.id !== gun.id);
    me.items.push({ ...gun, id: "new" });
    expect(jobLabel(w, me, job)).toBe(`Remove ${partDef("mg").name} from ${buggy.name}`);
  });

  it("names the parts a refit moves on the player's own grid", () => {
    const { w, me } = downedBuggy();
    const gun = me.items.find((it) => it.kind === "part" && partDef(it.part.defId).kind === "weapon")!;
    const job: Job = { kind: "refit", moves: [{ itemId: gun.id, from: { x: gun.x, y: gun.y, rot: gun.rot }, to: { x: 0, y: 0, rot: 0 } }], pickup: null, turnsLeft: 3, total: 3 };
    expect(jobLabel(w, me, job)).toBe(`Refit ${partDef(gun.kind === "part" ? gun.part.defId : "").name}`);
  });
});
