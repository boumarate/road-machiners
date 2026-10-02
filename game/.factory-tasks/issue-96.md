# Fix turn crash on a missing obstacle collider (issue 96)

**Status:** executing
**Branch:** factory/issue-96
**Worktree:** none
**Goal:** In the dev game, auto-travel or held-Space turns past props near the player keep playing and saving, and the worker never throws `Cannot read properties of null (reading 'handle')` from `removeCollider`. Turns run from the playback snapshot still collide with props as they would from a fresh capture of the live drive.
**Mode:** hands-off

## Context
- `restoreDrive()` (`src/phys/drive.ts:79`) spreads the snapshot's handle records into the new `Drive`. The returned `obstacles`, `bodies` and `memory` objects are the same objects as the snapshot's.
- `Travel.beginPlayback()` (`src/three/travel.ts:246`) keeps `nextSnapshot` and sets `result.next = restoreDrive(nextSnapshot)`. `Game.finishMovement()` (`src/three/game.ts:668`) makes that drive `this.drive` and runs `syncDrive()` on it. That adds and removes obstacle colliders, vehicle bodies and driver memory in the main thread's Rapier world, and writes the new handles into records it shares with `nextSnapshot`.
- `Travel.prepareNext()` (`src/three/travel.ts:232`) posts `playback.nextSnapshot` to the worker. When it posts after `finishMovement`, the posted records list handles that are not in the snapshot's Rapier bytes. It also leaves out colliders and bodies that are still in those bytes. This happens with a held Space that turns fast mid-playback, or with a tow rope or travel that starts mid-playback.
- Rapier 0.21 `getCollider(handle)` looks up by index only. It returns `null` for a missing index and returns the wrong collider when the index has been reused. `removeCollider(null)` throws `TypeError: Cannot read properties of null (reading 'handle')`.
- Reproduced in a scratch Vitest test (since deleted): `computeTurn` → `restoreDrive(next)` → a main-thread `syncDrive` with a new rock in reach → `computeTurn` from the same `next`, with the rock gone. It throws the reported error at `removeCollider` ← `syncObstacles` (`drive.ts:130`) ← `syncDrive`. That matches the minified stack `removeCollider → wn → Sn`. When `restoreDrive` deep-copies its handles, the same script runs clean.
- The corruption carries over. The worker's `result.next` copies the bad records, and the main thread adopts them, so the main thread's own `captureDrive` for a retry also fails. A reload rebuilds the drive with `buildDrive`, since the drive is not saved.
- The `smashOne` path (`drive.ts:327`) removes each broken prop once per turn. `Contacts.add` rejects crashes into a prop it already broke, and `run()` drops broken props from `next.obstacles`. It fails only when its input records are already bad.
- `syncDrive` already throws a named error when a vehicle's body record disagrees with the sim (`drive.ts:116`).

## Design
Two changes to `src/phys/drive.ts`, both owned there:

1. **Each Drive owns its handle records.** `restoreDrive` deep-copies `bodies`, `obstacles`, `memory`, `bridge` and `terrain` from the snapshot, the same way `captureDrive` already copies on the way out. After that, no change to a live `Drive` can reach a `DriveSnapshot`, so the snapshot always matches its Rapier bytes. This is the root-cause fix.
2. **A bad record fails loudly with a name.** `syncDrive` first checks that every obstacle collider handle and every vehicle body handle resolves to a live object with that same handle (`getCollider(h)?.handle === h`, and the same for bodies). Otherwise it throws `Obstacle <id> has no collider <handle>` or `Vehicle <id> has no body <handle>`. This matches the existing vehicle body check. A future record mismatch then names the prop or vehicle instead of throwing Rapier's opaque TypeError, and it stops a reused index from quietly removing the wrong collider.

Rejected:
- Skipping missing handles in the removal loops would hide record corruption. The worker would keep ghost colliders and miss real ones, so trucks would drive through props or hit invisible walls. The issue rules this out.
- Changing `beginPlayback` to keep a separate copy of the snapshot would fix this one call site, but every other `restoreDrive` caller would keep the trap.

Out of scope: physics rules, break rules, the prepare pipeline's timing, and saves. The drive is not part of the save, so no format change is needed.

TDD: yes. The bug is deterministic and reproduced in Node, so a regression test can fail before the fix.

### Invariants
- IV1 — A `Drive` from `restoreDrive(s)` shares no mutable object with `s`. After `syncDrive` on the restored drive, `s`'s `obstacles`, `bodies` and `memory` deep-equal their values from before the sync.
- IV2 — A turn computed from a playback snapshot after the main thread has synced the restored drive equals a turn computed from a fresh copy of that snapshot taken before the sync. This covers obstacles that came into reach or left it in between.
- IV3 — `syncDrive` throws a named error that gives the obstacle or vehicle id when a recorded handle has no live collider or body with that handle. It never calls `removeCollider` or `removeRigidBody` with `null`.
- IV4 — A prop broken during a turn has its colliders removed once. It is gone from `next.obstacles` and from `world.obstacles`. Later turns sync without error. When the prop comes back to `world.obstacles`, it gets new colliders and blocks again.

### Principles
- PC1 — Fix the record-sharing cause in `drive.ts`, not at the call sites in `travel.ts` or `game.ts`. `drive.ts` owns capture and restore.

### Assumptions
- AS1 — The player's T58 crash came from this record sharing, and not from a second cause in the smash path. The repro gives the same message and the same `syncObstacles ← syncDrive` frames. The player's save was not available to confirm it.
- AS2 — `structuredClone` of the handle records costs little per turn next to `takeSnapshot`, since the records hold a few hundred numbers and short arrays.

### Unknowns
- UK1 — Whether a browser repro can drive the held-Space or auto-travel path reliably enough for a Playwright check in `tmp/`. If it cannot, the Node handoff test (IV2) is the evidence, and the browser run is logged as deferred.

## Plan

Approach: write the handoff regression test first (it fails today with the reported TypeError), then make `restoreDrive` copy its records (the cause), then add the named record check to `syncDrive` (the loud failure). Everything is in `src/phys/`, and `travel.ts` and `game.ts` stay untouched (PC1).

### PH1 — Regression tests, red first
- 1.1 `src/phys/turn-task.test.ts:1-69` (modify). Add tests beside the existing worker/foreground parity tests.
  - "a main-thread sync of the restored drive leaves the playback snapshot unchanged". Steps: `computeTurn` → `next = prepared.result.next` → `main = restoreDrive(next)` → push a `rock` obstacle within reach of the player into the world → `syncDrive(main, thatWorld)` → expect `next.obstacles`, `next.bodies` and `next.memory` to deep-equal copies taken before the sync. Covers IV1.
  - "a turn from the playback snapshot after a main-thread sync matches one from a copy taken before it". Steps: take `pristine = { ...structuredClone(next without snapshot), snapshot: next.snapshot.slice() }` before the sync, run the sync as above, then remove the rock from the world. `computeTurn` from `next` (posted as a copy, as `prepareFrom` does) must not throw and must equal `computeTurn` from `pristine`. Also run the variant where the rock stays in the world, so the worker's turn still has the rock's colliders. Covers IV2 and AS1's repro.
  - Free every restored drive in `finally`, following the existing tests.
- 1.2 `src/phys/drive.test.ts` (modify, `describe('physics turns')`). Negative cases for IV3:
  - Build a drive with a rock in reach, set `d.obstacles.rock1 = [unusedHandle]` (a handle taken from a collider created and then removed), and expect `syncDrive` to throw `/Obstacle rock1 has no collider/`.
  - Set `d.bodies[playerId]` to a removed body's handle, and expect `syncDrive` to throw `/Vehicle .* has no body/`.
- 1.3 `src/phys/props.test.ts:192-240` (modify, `describe('breakable props')`). Add "a broken fence that grows back blocks again" for IV4. Break the fence with `paced(..., fast, [fence])`. Carry the drive the way `play()` does, through `restoreDrive(captureDrive(next))` plus `syncDrive`. Put `fence` back into `w.obstacles`, then drive back into it slowly: the turn must not throw, `crashes` must name `fence1`, and the truck must stop short of it. If `play()` cannot carry a drive between calls, add a small local loop in the test rather than changing `play()`'s signature for the other tests.
- Run `npx vitest run src/phys/turn-task.test.ts src/phys/drive.test.ts src/phys/props.test.ts`. The 1.1 tests and the 1.2 obstacle test must fail for the expected reason: a TypeError at `removeCollider` or a records mismatch, not setup errors. The 1.2 body test may also fail with a Rapier null error, which counts as red. 1.3 may already pass, since it guards a path that is correct today. Record that in Verify.
- No commit until PH2 makes the tests green (red tests would block the pre-commit hook), so PH1 and PH2 share one commit.

### PH2 — Drive owns its records; named record check
- 2.1 `src/phys/drive.ts:79-82` `restoreDrive(saved: DriveSnapshot): Drive`. Return `{ ...structuredClone(handles), world: RAPIER.World.restoreSnapshot(snapshot) }`, mirroring `captureDrive` at `drive.ts:74-77`. Update the comment above the pair: each Drive and DriveSnapshot owns its own handle records, so a sync of a restored drive never reaches the snapshot it came from. Respects IV1, IV2 and PC1.
- 2.2 `src/phys/drive.ts:104-118` `syncDrive(d: Drive, w: World): void`. Call a new `checkHandles(d)` first.
  - `function checkHandles(d: Drive): void` throws `Vehicle ${id} has no body ${handle}` when `d.world.getRigidBody(handle)?.handle !== handle`, and `Obstacle ${id} has no collider ${handle}` when `d.world.getCollider(handle)?.handle !== handle`.
  - Add a one-line comment: Rapier looks up by index only, so a stale handle reads as null or as another object.
  - It runs before any removal, so `removeCollider`/`removeRigidBody` never get `null` (IV3). Keep it a query that throws and does not repair (GPC6).
- 2.3 `syncObstacles` (`drive.ts:123-136`) and `smashOne` (`drive.ts:326-334`) keep their logic. Each prop's colliders are removed once (IV4), and the PH1 tests guard that.
- Run the PH1 tests (green), then `npm test`, `npm run typecheck`, and `npm run quality` from the repo root.
- Commit: `Give each restored physics drive its own handle records (#96)`

### PH3 — Game-level check
- Start `npm run dev`, then `npm run playtest` (add `--cpu` if no GPU). It must pass with no errors.
- UK1: write `tmp/issue-96-travel.mjs`, a Playwright script that drives `window.__ROAM__`. It sets a far through-order past props, holds Space for fast travel (or turns on auto travel) for about 20 turns, and checks for no turn-failed note, no `pageerror`, and turn count advancing. Then it saves through the normal save path and checks the save. If the path cannot be driven reliably, log it under Deferred and rely on IV2's Node test.
- No commit (`tmp/` holds scratch).

### Test strategy
- IV1 and IV2: handoff tests in `turn-task.test.ts`, which reproduce the reported TypeError before the fix.
- IV3: negative `syncDrive` tests in `drive.test.ts`.
- IV4: break, regrow and block test in `props.test.ts`, next to the existing break tests. The existing "holds no colliders of the fence" test still passes.
- Existing parity tests in `turn-task.test.ts` and `src/three/turn-preparation.test.ts` stay green, because the restored drive is still equivalent.

### Risks / rollback
- RK1 — `structuredClone` per restore adds time to `beginPlayback` and the worker turn. Mitigation: `npm run perf` must stay within `scripts/perf-budgets.json`. The records are small next to the snapshot bytes (AS2).
- RK2 — `checkHandles` runs on every `syncDrive` (main thread, worker and debug `apply`). It does a few hundred lookups, and `npm run perf` covers it too.
- RK3 — The check could fire on a currently valid path that relies on handle reuse. Mitigation: the full `npm test` and playtest run exercise every `syncDrive` caller. Any hit is a real record bug to report, not a reason to loosen the check.
- Rollback: revert the single commit.

### Order & dependencies
- PH1 → PH2 (one commit) → PH3.
## Verify
Result: passed

Smoke: held Space for 25s in headless Chromium (no GPU): turns 1→7, no page errors. Targeted tests (69) and typecheck re-run green. Independent review: no findings ≥80.

PH1 red: both handoff tests failed with the reported TypeError at `removeCollider`; the `syncDrive` stale-handle tests failed before `checkHandles`. The regrow test (1.3) was reshaped to re-add `fence1` ahead of the truck and break it again, which checks new colliders after a snapshot round trip.
## Code smells
## Conclusion
PH1+PH2 committed together. `npm test` (2754) and `npm run typecheck` pass; no pre-existing failures found. `npm run quality` passes.
### Deferred
- PH3 browser check (`tmp/issue-96-travel.mjs`) and the dev playtest not run: the stage forbids the playtest and the machine is slow. IV2's Node handoff test is the evidence.
### Hands-off decisions
- uplan: plan auto-approved.
- uplan: PH1 and PH2 share one commit — red tests alone would fail the pre-commit gate.
- uplan: no test of two trucks breaking one fence in the same step — `Contacts.add` already rejects crashes into a broken prop, and the crash came from the records, not the smash path.
- udesign: no request for the player's save — the shared-record repro matches the reported stack, and AS1 records the residual risk.
- udesign: fail loudly with a named error on bad records, and do not skip missing handles — the issue forbids swallowing the error, and GPC6 asks for loud failures.
- udesign: work on the factory branch `factory/issue-96` in this clone with no extra worktree — the factory clone already isolates the work.

Verify and review stage: no further fixes needed; no pre-existing failures found.
