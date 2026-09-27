# Waypoint travel prototype

Goal: Route planning stays paused and unchanged. One Space press outside combat follows the planned waypoint without repeated presses, with Space to pause and held Space to advance faster.

## Context
- Movement currently needs one Space press per turn, even on a long safe route.
- Physics already resolves stop-at orders and emits arrival events.

## Design
Keep the existing turn simulation and run completed turns in sequence. Clicks only plan a drive-through waypoint, and Shift-clicks plan a stop-at waypoint. Both keep time paused and preserve the route preview. Outside visible danger and direct-drive mode, Space starts or resumes automatic travel along the planned route. Space pauses automatic travel after the current turn without clearing the route. Without a waypoint, or in combat or direct-drive mode, Space advances one turn. Holding Space advances turns at four times playback speed, including combat. Releasing it ends fast-forward and preserves any active automatic travel.

Automatic travel stops on arrival, visible hostiles, player combat, collision, breakdown, defeat, an empty tank, an open panel or loss of browser focus. An interrupted route stays available for manual turns. Held Space is deliberate fast-forward and can advance combat. Reload starts paused. Turns remain atomic, so pausing never rolls back an already resolved turn.

A timer-based loop would duplicate playback readiness and risk overlapping turns. A simulation-time rewrite would expand the prototype. Use the existing animation loop and a small controller instead.

TDD: yes for the deterministic controller. Browser checks cover real keyboard input, physics arrival and interruption.

### Invariants
- Clicks never start time or change drive-through orders into stop-at orders. Space starts automatic travel.
- Only the existing turn pipeline changes world time, with no overlapping turns.
- Automatic travel never starts with a visible hostile and stops before another turn after a threat appears.
- Releasing Space ends fast-forward, and focus loss clears both held advancement and automatic travel.
- Playback speed changes do not skip simulation turns or combat phases.

## Plan
- `src/three/travel.ts` owns automatic and held advancement state and reads sim state for travel safety. Sim modules never import it.
- `src/three/travel.test.ts` owns controller and safety regression tests.
- `src/three/game.ts` owns browser input, playback timing and the decision to run the next turn through the controller.
- `src/config.ts` and `.env.example` own required hold delay and fast-forward speed settings.
- `src/ui/hud.ts` owns the updated control hint. `DESIGN.md` describes the controls and `CLAUDE.md` records configuration and ownership.
- Keep all work on `prototype/sr2-navigation` in `.worktrees/sr2-navigation`, based on main at `96a0898`. Do not merge or touch the main checkout's pending edits.

## Verification
- The first prototype incorrectly started travel on click and replaced ordinary clicks with stop-at orders. The corrected contract preserves planning and starts travel on Space. Four controller and physics tests reproduced the missing Space-start behavior before the repair.
- Corrected Space-start behavior passed 37 focused travel, save and sound tests, typecheck, and browser checks for paused planning, drive-through and stop-at order preservation, Space start, pause and resume, held speed, focus loss, panels and combat interruption. Browser evidence is in `tmp/navigation-space-browser.log`.
- The corrected standard playtest passed 12 turns at 60.5 fps. The planning screenshot is `tmp/navigation-planning.png`.

## Turn-boundary stutter
The foreground probe at `tmp/travel-profile-before.log` measured 200–300 ms rendering blocks at most turn boundaries, with one 366 ms gap. Route and physics calculation ran on the drawing thread, and playback reset its clock after each gap.

- `src/phys/drive.ts` owns portable physics snapshots.
- `src/phys/turn-task.ts` computes the unchanged turn pipeline from a snapshot. `src/phys/turn-task.test.ts` compares it with foreground simulation and checks input preservation.
- `src/phys/turn-worker.ts` owns background calculation and retains terrain identity for route caches.
- `src/three/turn-preparation.ts` owns one prepared result keyed to its exact input world. Its tests cover readiness, stale results and visible failure.
- `src/three/game.ts` prepares the next turn during playback, commits it only when advancement is still requested, and carries playback time across ready boundaries before drawing. Paused planning remains on the main thread.
- `src/perf.ts` merges worker measurements, with `src/perf.test.ts` checking aggregation. `scripts/perf.mjs` waits for asynchronous turns before reading their timing.

A prepared turn does not change visible world state, saves, sounds or RNG state. Pausing retains the result without committing it. Replanning invalidates it by world identity. At most one future result is retained, and worker failures reach the crash screen.

The final worker implementation passed all 499 tests, worktree typecheck, production build, browser control checks and the standard 12-turn playtest at 60.5 fps. A delayed-worker browser test first reproduced an extra turn after releasing Space, then passed after keeping automatic advancement separate from an explicit single-turn request. The final profile recorded 21 turn-boundary frame gaps of 16.6–33.3 ms, down from 200–366.7 ms. Evidence is in `tmp/worker-final-pause.log`, `tmp/worker-final-controls.log`, `tmp/worker-final-playtest.log` and `tmp/travel-profile-cached.json`.

Worker transfer dropped the terrain's frozen flags, causing turn cloning to copy terrain and rebuild route caches. A regression test reproduced this. Restoring immutability and warming navigation layers reduced worker calculation in the final travel profile to a 70.1 ms maximum across 22 calculations. The worker starts lazily to avoid competing with boot.

`npm run perf -- --url http://127.0.0.1:5175` still failed cold-start budgets: boot 2295.8 ms against 2000 ms and first turn 154.1 ms against 100 ms. Later turns took 37.9–63.0 ms. Preview and frame budgets passed. These misses remain recorded in `tmp/worker-final-perf.log`.

The language-server tool reported a missing `mergePerf` export even though the worktree source exports it and fresh typecheck and build both passed. Compiler verification is recorded in `tmp/worker-typecheck.log` and `tmp/worker-build.log`.

## Conclusion
The prototype runs in the isolated worktree with local dependencies. Simulation rules and saved world structure are unchanged. Automatic travel state is session-only. The main checkout is untouched and the branch is not merged.

