# NPC jams

## Context

- A headless run of 800 turns on seed 1, with every truck in far travel, finds 25 cases of an NPC standing still for 20 turns or more on a goal that needs driving. The probe is `tmp/jam.ts`.
- Cause 1, the main jam: `facesParked()` in `src/sim/ai.ts` makes a driver wait for a parked truck ahead that "wants to drive". `wantsToDrive()` guesses that from the other truck's top goal. It does not look at what that truck does. So drivers wait for trucks that never move: a stranded truck waiting for a tow, or a truck that is itself waiting. A tow truck even waits for the stranded truck it came to tow. 12 of the 25 cases, all in one cluster near (400, 124).
- Cause 2: the route planner returns the closest reachable point when it cannot reach the order point. Far travel then ends the order as arrived. Physics does not, and keeps pushing toward the point. The goal layer ignores both and waits for the truck to come within 1 tile. So a goal to a point a parked truck covers never ends. Example: an investigate goal that stays 3 tiles short of the truck it investigates.
- Some cases are consequences of cause 1. For example, a truck boxed in by parked trucks has no route out at all.

## Desired design

- A driver gives way only to a truck that holds a move order. The order is the one source of what a truck will do, so the yield rule reads it instead of guessing from goals.
- Arrival means one thing in both movement layers: the truck reached the order point, or the closest point the route planner can reach. Physics stop orders arrive at the route's end when that end falls short of the order point, as far travel already does.
- Point goals, like investigate, flee, raid, patrol and explore, end when their move order arrives. The distance check stays as well.
- Scope: site goals keep their pad rule. The escort wait and the deal rules from the previous commit stay as they are.

## Invariants and principles

- Two trucks nose to nose that both drive still settle it by id: one waits, the other goes around. Existing traffic tests keep passing.
- The id order still breaks every waiting chain. A truck waits only for a higher id with a move order, so no cycle can form.
- A through order is unchanged. Only stop orders gain the route-end arrival.
- A careless driver has no route. Its arrival point stays the order point.

## Implementation plan

### Phase 1 — no waiting for trucks that will not move

- `src/sim/ai.ts` `wantsToDrive(world, x)`: true when `x.order` is a stop or through order whose point lies farther than the reach rule from `x`. Drop the goal-based guess and its comment about unthought goals.
- Test in `src/sim/ai.test.ts`: a driver facing a parked stranded truck that has no move order gets a move order, not a brake. The reverse case still waits: the parked truck holds a move order and has the higher id.

### Phase 2 — one arrival rule

- `src/phys/drive.ts` `planTurn()`: a stop order's arrival point is the route's last point when a route exists, else the order point. `arrivalTarget()` measures against that point.
- `src/sim/npc-activities.ts` `reachedDestination()`: also true when the truck's move order arrived this turn, read from the `arrived` event both layers push. It takes the world for that.
- Tests: in `src/phys/drive.test.ts`, a stop order at a point inside a rock arrives at the route's end and clears the order. In `src/sim/npc-activities.test.ts`, an investigate goal whose point a parked truck covers ends once the truck's move order arrives short of it.

### Phase 3 — a catch-all for any jam

- `src/sim/ai.ts` `noteStuck()`: a driver that stays put `RULES.unstick.turns` turns in a row with its goal point out of reach drives `RULES.unstick.driveTurns` turns to a random free spot within `RULES.unstick.reach` tiles. It reuses the recovery fields that the back-out rule uses. A recovery order now wins over a traffic stop and an escort wait.
- Numbers in `RULES.unstick` in `src/data/rules.ts`: 20 turns, 6 tiles, 3 turns.
- Tests in `src/sim/ai.test.ts`: a leader held by a lagging escort drives to a spot nearby after the wait. A driver parked on its goal point never counts as stuck.

## Progress

- Phase 1 done: `wantsToDrive()` reads the move order. Tests in `src/sim/ai.test.ts`.
- Phase 2 done: `planTurn()` stops at the route's end. `reachedDestination()` also counts the `arrived` event. Field repair keeps the distance rule through `withinReach()`. Each new test failed before its fix.
- Phase 3 done.
- The negative try found a gap in Phase 1. Two trucks that park nose to nose and set off in the same turn both drove, since neither held an order yet. Drivers now think in world order and then take orders from the highest id down, so the truck a driver waits for always holds this turn's order. Thinking keeps world order, so claims like a beacon answer keep going to the first in line.

## Verification

- `npm test` for the changed test files, then the full suite, `npm run quality` and `npm run typecheck`.
- `npm run playtest`, since the physics driver changes.
- Manual try, positive: rerun `tmp/jam.ts 800 1`. The traffic cluster and the unreachable point goals are gone, and the stall count drops well below 25. Each remaining stall gets a named cause.
- Manual try, negative: two NPC trucks parked nose to nose, both with far goals. Within a few turns both are moving and neither overlaps the other.

## Result

- Done. Stalls of 20 turns or more in the 800-turn run on seed 1 went from 25 to 13. The traffic cluster is gone.
- Each remaining stall has an intended cause. Four trucks wait for a tow truck on its way. Five convoy leaders wait for an escort driving back from 50 to 277 tiles away. Two searches do not start while a hostile is in sight. One stranded truck stands 1.4 tiles from a loot pile.
- Checks: all 1964 tests pass. `npm run quality` passes, and `npm run playtest` passes against a dev server in the worktree.
- Manual try, positive: the jam run above.
- Manual try, negative: in physics, two trucks parked nose to nose, each bound past the other. The lower id waits 2 turns while the other goes around. Neither crashes, and the gap between them stays above 0.36 tiles.
- Not changed: a broke driver with no cargo to sell waits for good. That is the service rule, not a jam.
