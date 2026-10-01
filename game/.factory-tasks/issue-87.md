# Fewer NPC-to-NPC crashes in head-on traffic (issue 87 hotfix)

**Status:** executed
**Branch:** factory/issue-87
**Worktree:** none
**Goal:** In the all-physics traffic measurement (`tmp/collide.mjs`, seeds 1-4, 300 turns, `--live 1000`), damaging peaceful NPC-to-NPC collisions drop clearly below the HEAD baseline of 100, head-on ones below 41, with no stall events that HEAD does not have, and the new regression scenario passes. `npm run playtest -- --cpu` stays clean.
**Mode:** hands-off

## Context

Measured on HEAD 9a868a0 (main, which holds the 2026-10-01 release) with `tmp/collide.mjs`: every NPC gets a physics body (`--live 1000`), the god-mode player stays parked, and the script counts `collision` events between two NPCs. It splits off rams (`ramTarget`), hostile pairs and the player, and it sorts the rest by geometry and by whether any part took damage. Runs are deterministic: reruns give identical numbers.

- The premise does not hold that the recent pathing changes caused the extra crashes. Seeds 1-4 × 300 turns gave 353 peaceful contacts on HEAD, 323 with issue #33 (`23388fe`, back-out limit) reverted and 370 with issue #36 (`d2637bd`, straighter routes) reverted. The pre-release main `508aab4` gave 237 on seeds 2-4, against 273 for HEAD on those seeds. Every difference is inside the seed-to-seed noise of ±25.
- NPCs crash often at every version. HEAD has 100 damaging peaceful contacts per 1200 truck-turns of all-physics traffic. Head-on contacts are the largest damaging group with 41, ahead of crossing (22), a parked truck hit (19) and same direction (18). The soft contacts are mostly low-speed nudges at pads and by escorts.
- Cause of the head-on crashes, traced on a snapshot of seed 2 at turn 90 (`tmp/snap-s2-t90.bin`, `tmp/case.test.ts`). Two NPCs close on one road at about 10 tiles per turn. From 28 tiles apart each sees the other in `conflicts()` and plans around the other's `sweptPath()`, which assumes the other holds its heading. Neither stops, since `trafficStops()` (`src/sim/ai.ts:330`) stops a driver only when the detour fails or runs long. Both swerve by about a tile, and one turns toward its own goal across the other's lane, so they meet at full speed. The damage was 96, or 133 in the original run.
- `facesParked()` (`src/sim/ai.ts:360`) already breaks the same symmetry for two parked trucks nose to nose: the lower id waits and the higher one goes around. `planNpcOrders()` sets orders from the highest id down for this reason. Moving trucks closing on each other have no such rule.
- A prototype in a scratch worktree added one line to `trafficStops()`. A driver brakes when a moving NPC with a higher id has it in its own `conflicts()` too, and neither fights nor flees. Damaging contacts fell from 100 to 75 and head-on ones from 41 to 16. All contacts fell from 353 to 322. The traced crash became a pass at 3.7 tiles.
- On TEST_MAP, two fresh scouts at the seed 2 turn 93 poses (`tmp/scouts.test.ts`) crash on HEAD for 4 of 25 nearby goal points of the second scout, one of them for 200 damage. With the prototype, none of the 25 touch. On flat ground (`tmp/headon2.test.ts`) HEAD never crashes, so the scenario needs the real road.
- The 20-turn unstick escape (`RULES.unstick.turns`) and `RULES.npcStuckTurns` do not cause these crashes. Only 11 of the 353 HEAD contacts involve a driver on a recovery drive, and the traced crashes have `stuck` and `recovery` at 0.
- `npm run stuck` moves every truck with far movement, which never crashes. Physics crashes need the measurement script above.

## Design

When two NPC drivers close on each other, so each has the other in `conflicts()`, the driver with the lower id brakes for the turn. The one with the higher id plans as today and goes around a truck that is slowing down on its heading, which it predicts far better than one that swerves. This applies the face-off tie break that parked trucks already use to moving trucks. `conflicts()` needs the other truck within 45° of the nose, so two trucks that each have the other in it face each other, head-on or crossing. A follower behind its leader never has this. So convoys, overtaking and escorts keep their current behavior.

The rule lives in `trafficStops()` after the `isNear()` check, beside `facesParked()`, as a named helper like `facesOncoming()`. `src/sim/ai.ts` keeps ownership of who yields. Physics, routing and data stay unchanged.

Who yields:
- Only near NPCs. Far drivers already stop short of every truck.
- Both trucks give way, by `givesWay()`, so neither fights nor flees. A driver that fights or flees never brakes for this rule, and nobody brakes for one either. Rams and tow ropes stay excluded through `others()`.
- The player never gives way and is never yielded to by this rule. NPCs keep routing around the player as today.
- The lower id brakes. That is the same order `facesParked()` uses, so the id order cannot form a cycle.

Deadlock: the rule holds only while the higher-id truck moves and still closes on the braking one. Once it passes, or stops because it cannot get around, the rule lapses. Two parked trucks then fall under `facesParked()` and `noteStuck()` as today. Braking for traffic already keeps `noteStall()` from starting a recovery.

Approaches considered:
- A, chosen: the lower id brakes for a mutual conflict. It is one rule beside an existing one, needs no new number, and the prototype cut head-on damage by 61%. Its cost is that one of two oncoming NPCs slows down briefly where both used to keep speed.
- B: predict the other truck's swept path along its planned route instead of its heading. It would fix the prediction itself, but the route lives in the physics driver's memory, outside the sim. It would change routing for every driver, which is too broad for a hotfix.
- C: keep to the right when passing, with blockers on the left of an oncoming truck. It changes routing and road use, and it needs new geometry and tuning.

Out of scope: the other contact groups, which are pad crowding, escorts nudging leaders, parked trucks hit at pads, and rear-ends. They are separate mechanisms and were not part of the recent changes. `RULES.unstick.turns`, `RULES.npcStuckTurns`, the issue #33 and #36 changes, and every balance number stay as they are. The factory's hotfix release steps (main, itch.io, back-merge to dev) are not code in this task.

TDD: yes — a deterministic sim rule with a reproducible physics regression. Both tests fail on HEAD first.

### Invariants
- IV1 — Of two near NPCs that both give way, are both moving and each have the other in `conflicts(…, 0)`, `trafficStops()` is true for the lower id. For the higher id, the new rule adds no stop.
- IV2 — The new rule never stops a driver that fights or flees, nor a driver for a truck that fights, flees or is the player, nor a far driver.
- IV3 — Two NPCs driving the same way, one behind the other or side by side, are not stopped by the new rule.
- IV4 — In the TEST_MAP regression scenario, two scouts with plain explore goals close head-on and never touch.
- IV5 — The all-physics measurement shows no stall event on seeds 1-4 that HEAD does not have, and `npm run stuck -- --seeds 1-3` stays clean.

### Principles
- PC1 — Smallest correct change for a hotfix: one rule in `src/sim/ai.ts`, no new numbers in `src/data/`, and no change to routing, physics or recovery.
- PC2 — Reuse the existing traffic vocabulary: `conflicts()`, `givesWay()`, `others()` and the lower-id tie break of `facesParked()`.

### Assumptions
- AS1 — The all-physics measurement stands in for play near the player, where NPCs have physics bodies. Real play has fewer trucks in physics at once, so absolute counts are lower.
- AS2 — The committee accepts that the issue's premise did not hold, since the recent pathing changes did not raise the crash rate, and that the hotfix targets the measured top cause instead.

### Unknowns
- UK1 — How much of the remaining head-on damage (16 in the prototype) comes from trucks that fight or flee, which the rule leaves alone. This needs answering only if the goal is missed.

## Plan

Approach: write the two failing tests first and confirm they fail on HEAD. Then add one predicate to `src/sim/ai.ts` and call it from `trafficStops()`, and update the two docs that state when NPCs stop. One phase, since the change is one rule with its tests and docs.

### PH1 — Lower id brakes for an oncoming NPC
- 1.1 `src/sim/ai.test.ts:96-157` (modify), a new `describe('oncoming NPCs')` after `NPC traffic`. Write it first and see it fail.
  - Fixture: two near traders on `emptyWorld`, `first` at (100,100) heading 0 and `second` at (114,100.5) heading π, both at speed 4, with explore goals past each other. Assert `first.id < second.id`, as in `noseToNose()`.
  - "of two NPCs closing head-on, the lower id brakes and the higher drives on": `planNpcOrders(w)` gives `first.order.kind === 'brake'` and `second.order.kind === 'stopAt'` (IV1).
  - "a fleeing or fighting truck is not yielded to, and does not yield": push a `flee` goal on `second`, then `trafficStops(w, first, …)` is false. Do the same with the goal on `first` (IV2).
  - "a far pair does not use the rule": move the player out of live range. `trafficStops` is false for `first` (IV2).
  - "a truck behind on the same heading does not make the leader brake": `second` at (94,100) heading 0, speed 5. `trafficStops(w, first, …)` is false (IV3).
  - The existing `NPC traffic` cases against the player must stay green unchanged (IV2).
- 1.2 `src/phys/ai.test.ts:91-133` (modify), a new physics case after "passes the oncoming player…". Write it first and see it fail on HEAD.
  - Setup as in the oncoming-player test: `newWorld(1337, START_KITS.standard, TEST_MAP)`, only the player kept, every spawn timer at `MAX_SAFE_INTEGER` and the player parked at (300,200). Add two `scout` trucks with `['mg', 'stockEngine']`: a scavenger at (264.24,165.07) heading -48° at speed 6.46 with an explore goal to (317,102.75), then a roamer at (283.01,143.29) heading 129° at speed 4.08 with an explore goal to (276.07+dx, 157.15+dy).
  - `it.each` over dx ∈ {-3, -1.5} and dy ∈ {-3, -1.5, 0, 1.5, 3}. Play 10 turns through `turn()` and expect no `collision` event between the two (IV4). On HEAD, 4 of these 10 collide (`tmp/scouts.test.ts`: (-3,-1.5) for 200 damage, and (-1.5,0), (-1.5,1.5), (-1.5,3)). If the suite runs too slowly, keep the 4 failing cases plus (-3,0) as a pass control.
  - Give the test the same 120 s timeout as its neighbours.
- 1.3 `src/sim/ai.ts:330-342` (modify) `trafficStops()`. After `if (!isNear(world, v)) return false;` add `if (facesOncoming(world, v)) return true;`, ahead of the `moving` early return. The `moving` list it needs is `conflicts(world, v, 0)`, so compute it once and pass it in if that reads cleaner.
- 1.4 `src/sim/ai.ts:358-367` (modify), near `facesParked()`. Add `function facesOncoming(world: World, v: Vehicle): boolean`. It is true when `givesWay(v)` and some `x` in `conflicts(world, v, 0)` has `v.id < x.id`, `givesWay(x)`, and `conflicts(world, x, 0)` contains `v`. Give it a one-line comment saying why: each would plan around the other's straight path, so the lower id waits and the higher goes around, as in a face off. Respects IV1-IV3, PC1, PC2.
- 1.5 `src/sim/ai.ts:310-318` (modify), the block comment over "Traffic". Add that of two NPCs closing on each other the lower id brakes.
- 1.6 `CLAUDE.md:50` (modify), the `src/sim/ai.ts` bullet. After "They stop only when that path blocks the way.", add: "Of two NPCs closing on each other, the lower id brakes and the other goes around."
- 1.7 `DESIGN.md:193` (modify). After the first sentence, add: "Of two drivers closing on each other, one waits while the other goes around."
- Commit: `NPCs closing head-on no longer both swerve into each other: the lower id brakes (issue 87)`

### Test strategy
- RED first: run `npm test -- src/sim/ai.test.ts src/phys/ai.test.ts` on HEAD with only 1.1 and 1.2 written. The new cases must fail for the rule, not for setup. The `planNpcOrders` case gives `stopAt` for `first`, and the physics cases record a collision.
- GREEN: the same command, then `npm test`, `npm run typecheck` and `npm run quality` from the repo root.
- Regression of the goal: `npx vite-node tmp/collide.mjs -- --seed <s> --turns 300 --live 1000` for seeds 1-4, four in parallel, about 12 minutes. Compare to the HEAD numbers in Context: damaging 22/30/25/23, head-on damaging 41, stalls 0. The prototype gave 18/17/16/24, 16 head-on and 1 unrelated stall on seed 3 (see Code smells). A new stall in the final code must be traced with `tmp/snap.test.ts` and `tmp/one.test.ts` before it is called unrelated (IV5).
- `npm run stuck -- --seeds 1-3` stays clean (IV5). Far movement does not use the rule, so this is a guard only.
- `npm run playtest -- --cpu` against a dev server, per CLAUDE.md for game changes.

### Risks / rollback
- RK1 — Physics regression cases can be brittle to later driving tuning. The poses come from a real crash, and the assertion is only "no contact", so a later failure points at a real regression. Rollback is reverting the one commit.
- RK2 — More braking may slow traffic or make a pair hesitate. The rule holds only while the other truck moves and closes on this one, and the id order allows no cycle. IV5's stall checks guard this.
- RK3 — The scratch tools in `tmp/` (`collide.mjs`, `snap.test.ts`, `case.test.ts`, `one.test.ts`, `scouts.test.ts`, `vitest.config.ts`, the snapshots) are git-ignored and not part of the change. Run the vitest ones with `npx vitest run --config tmp/vitest.config.ts <file>`.

Backward compatibility: no save shape, content id or interface changes. No migration.

## Verify

## Code smells
- A physics-mode stall appeared once in the prototype run, seed 3 turn 224: `v126` gave up `resupply` with "needs repairs". It stood still with no truck within 12 tiles, so the yield rule did not cause it. It is a world that diverged by chance, and HEAD seed 3 has none. Unrelated to this task.
- `tmp/collide.mjs` and friends are scratch tools. The repo has no physics traffic soak that counts NPC crashes, so `npm run stuck` cannot catch this class of regression.

## Conclusion

### Hands-off decisions
- udesign: treat the request as "reduce unintended NPC-to-NPC crashes", since measurement found no regression from issues #33 or #36 — the issue asks to find the real cause and the data names head-on traffic.
- udesign: lower id brakes on a mutual conflict (approach A) — the smallest rule, it mirrors `facesParked()`, needs no new numbers and is measured to work.
- udesign: leave `RULES.unstick.turns` and `npcStuckTurns` unchanged — the traces show recovery drivers in 3% of contacts and none of the traced crashes.
- udesign: other contact groups (pads, escorts, rear-ends) are out of scope — separate mechanisms and not part of a smallest hotfix.
- uplan: plan auto-approved
- uplan: one phase with tests first — one rule with its tests and docs, so no interface graph.

### Execution
- PH1 done inline in one commit. New tests failed on HEAD first (1 sim case, 4 physics cases), pass now. `npm test` (2713) and `npm run typecheck` pass. No pre-existing failures found, so no separate fix commits.
- Not run here: `tmp/collide.mjs` seeds 1-4, `npm run stuck`, `npm run quality` (the commit hook ran it). Left for the verify stage.

### Verify
- `npx vitest run src/sim/ai.test.ts src/phys/ai.test.ts` and `npm run typecheck` pass. `npm run stuck -- --seeds 1-3` is clean after the fix below. `tmp/collide.mjs` was not rerun (about 12 minutes).
- Found: `npm run stuck` seed 1 errored at turn 601 ("A radio call is open"), because the changed traffic let an NPC open a call to the parked player. The soak never hung up. Fixed in its own commit: `src/test/stuck-soak.ts` hangs up an open call.
