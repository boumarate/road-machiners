# Fast varied NPC routes

**Status:** executing
**Branch:** route-variety
**Worktree:** .worktrees/route-variety
**Goal:** In the convoy scenario, route planning per real turn drops at least 4x from the baseline, drivers still split onto at least 3 ways between Bowl and Nose, and the user confirms turns feel smooth in play.
**Mode:** hands-off

## Context

Measured with `tmp/lag.mjs`, the convoy scenario: six traders leave Bowl for Nose next to the player, 15 turns, headless Chromium on the Metal GPU. Main and branch cost the same.

- Commit 280659b gives each NPC driver a smooth route taste field. Drivers from Bowl to Nose split onto 3 clearly different ways out of 10.
- Over 15 turns, fresh route searches take 1.46 s in 91 calls, kept-route reuse takes 0.91 s in 286 calls, and physics takes 0.44 s.
- The path preview simulates 3 turns ahead, and each simulated turn plans every live NPC again. So each NPC plans about 4 times per real turn.
- `continueRoute` in `src/sim/path.ts` re-straightens the whole remaining trip on every reuse. On a 500-tile trip that samples ground cost along all of it.
- 56 of 286 reuses fail and trigger a full-trip search. 43 fail because the leg from the truck to its next corner is blocked, 13 because a newly parked truck lies on some leg.
- Fights stay fast because fighters drive straight at targets and plan no routes.

## Design

A driver rethinks only the road near it. The kept route stays the plan for the rest of the trip.

1. Local straightening. On reuse, `continueRoute` straightens only the corners within a lookahead distance along the route. Points past it stay as kept.
2. Local repair. When legs of the kept route are blocked, the driver searches from its position to the first kept point past the last blocked leg. The repair joins the rest of the kept route. If the repair cannot reach that point, the driver plans the full trip, as today.
3. Taste stays per driver. Fresh searches, repairs and straightening all weigh cost by the driver's taste, so a repair keeps the driver's way.

A precomputed atlas of site-to-site routes stays out of this task. After steps 1 and 2, full-trip searches happen only at trip start and on a destination change. The atlas would speed only those, and it would replace per-driver taste with a few shared variants.

The convoy scenario is the benchmark. It stays in `tmp/` and is run before and after.

TDD: yes. Route reuse is deterministic sim code with clear expected outputs.

### Invariants

- IV1 — Every leg of a reused or repaired route clears static obstacles, cliffs, rails and every dynamic blocker by the same margins a fresh plan uses.
- IV2 — A reused or repaired route ends where the kept route ends, or at the new destination when it moved.
- IV3 — The same world and driver give the same route, so the preview matches the turn.
- IV4 — The driver-taste test still finds at least 3 distinct ways among 10 drivers from Bowl to Nose.
- IV5 — Local straightening never raises the tasted cost of the stretch it replaces.

### Assumptions

- AS1 — The convoy scenario reproduces the lag the user felt in play.
- AS2 — Most blocked legs sit near the truck, so repairs are short searches.

### Unknowns

- UK1 — The lookahead distance. It must cover at least the preview's 3 turns at top speed.
- UK2 — Whether the preview's 3 simulated turns still dominate after steps 1 and 2.

## Plan

Approach: all changes sit in `continueRoute` in `src/sim/path.ts`, the one place drivers reuse a kept route. Callers keep their signatures, so the physics driver and the preview pick up the change unchanged.

### PH1 — Local straightening
- 1.1 `src/data/region.ts:34-46` (modify)
  - Add `REGION.navigation.lookahead: 48`. Tiles along a kept route that a reuse re-straightens. The comment derives it: the fastest chassis with the strongest engine drives 11.7 tiles per turn, and a real turn plus 3 preview turns is 4 turns. Resolves UK1.
- 1.2 `src/sim/path.ts:97-123` (modify)
  - `continueRoute()` ends with `straightenAhead(...)` in place of `shortcut(...)` over the whole rest.
  - New private `straightenAhead(nav, statics, dynamic, from: Vec, points: Vec[], reach: number, taste: Taste | null): Vec[]`. It runs `shortcut()` on the points up to the first one past `lookahead` tiles of route length from `from`, then appends the rest unchanged. Respects IV5 through the unchanged shortcut rule, and IV3.
  - Wrap `continueRoute` in `timed('route-continue', ...)`, so the dev panel and the benchmark see reuse cost.
- Tests first, in `src/sim/path.test.ts` under `kept routes`:
  - On a long kept route with many corners, a continue from the start keeps every point past the lookahead identical and in order.
  - Existing kept-route tests still pass.
- Commit: `Straighten only the road ahead when a driver reuses its route`

### PH2 — Local repair
- 2.1 `src/sim/path.ts:97-123` (modify)
  - New private `lastBrokenLeg(...)`: index into `rest` of the end point of the last leg that fails. The checks stay as today: the first leg and a moved last leg must not touch, and legs must clear fresh blockers by `reach`. It returns -1 when all legs hold.
  - On a broken leg `b`, `continueRoute` calls `route(world, from, rest[b], radius, extra, driver)`. It joins the result with `rest.slice(b + 1)` and then straightens ahead. When the repair ends short of `rest[b]`, `continueRoute` returns null, and the caller plans the full trip as today. Respects IV1, IV2, IV3.
  - `count('route-repair')` on each repair and `count('route-repair-failed')` on each null, for the benchmark.
  - Update the comment above `continueRoute` to describe the repair.
- Tests first, in `src/sim/path.test.ts` under `kept routes`:
  - A vehicle parked on a later leg gives a repaired route. Every leg clears it by radius plus clearance, the route ends at the kept end, and the points after the broken leg are the kept ones. This replaces the old assertion that such a route is dropped.
  - A kept route whose first leg is blocked is repaired from the truck's position.
  - A repair target walled in by a parked vehicle returns null.
- Commit: `Repair a blocked kept route locally instead of replanning the trip`

### PH3 — Measure
- Run `tmp/lag.mjs` on the branch before PH1 and after PH2. Compare `route` plus `route-continue` per real turn. Record the numbers and the repair counts in `## Verify`. The goal needs at least 4x less.
- Run `npm test`, `npm run quality`, `npm run playtest` and `npm run perf`, with main as the perf baseline, since both miss the boot and turn budgets on this machine.
- Resolves UK2 and checks AS1 and AS2 through the repair counts and the user's play check. Checks IV4 through the existing driver-taste test.

### Risks / rollback
- RK1 — A repair that keeps missing its point replans the full trip every turn, as today. `route-repair-failed` shows it in the benchmark.
- RK2 — Corners past the lookahead are straightened only when the truck gets close, so a far-away route can look less straight in the preview course. Straightening itself does not change which way the driver takes.
