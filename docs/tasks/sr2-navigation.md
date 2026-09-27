# Waypoint travel prototype

Goal: A ground click outside combat drives to a waypoint without repeated Space presses, with Space to pause and held Space to advance faster.

## Context
- Movement currently needs one Space press per turn, even on a long safe route.
- Physics already resolves stop-at orders and emits arrival events.

## Design
Keep the existing turn simulation and run completed turns in sequence. Outside visible danger and direct-drive mode, a ground click sets a stop-at waypoint and starts automatic travel. Combat and direct-drive clicks retain the current precise controls. Space pauses automatic travel after the current turn without clearing the route. A Space press while paused advances one turn. Holding Space explicitly advances turns at four times playback speed, including combat, until released. A new ground click resumes automatic travel.

Automatic travel stops on arrival, visible hostiles, player combat, collision, breakdown, defeat, an empty tank, an open panel or loss of browser focus. An interrupted route stays available for manual turns. Held Space is deliberate fast-forward and can advance combat. Reload starts paused. Turns remain atomic, so pausing never rolls back an already resolved turn.

A timer-based loop would duplicate playback readiness and risk overlapping turns. A simulation-time rewrite would expand the prototype. Use the existing animation loop and a small controller instead.

TDD: yes for the deterministic controller. Browser checks cover real keyboard input, physics arrival and interruption.

### Invariants
- Only the existing turn pipeline changes world time, with no overlapping turns.
- Automatic travel never starts with a visible hostile and stops before another turn after a threat appears.
- Releasing Space stops held advancement, and focus loss clears both held advancement and automatic travel.
- Playback speed changes do not skip simulation turns or combat phases.

## Plan
- `src/three/travel.ts` owns automatic and held advancement state and reads sim state for travel safety. Sim modules never import it.
- `src/three/travel.test.ts` owns controller and safety regression tests.
- `src/three/game.ts` owns browser input, playback timing and the decision to run the next turn through the controller.
- `src/config.ts` and `.env.example` own required hold delay and fast-forward speed settings.
- `src/ui/hud.ts` owns the updated control hint. `DESIGN.md` describes the controls and `CLAUDE.md` records configuration and ownership.
- Keep all work on `prototype/sr2-navigation` in `.worktrees/sr2-navigation`, based on main at `96a0898`. Do not merge or touch the main checkout's pending edits.

## Verification
- `npm run typecheck` passed. The full `npm test` run passed 492 tests. The final focused travel run passed 17 tests, including the subsequently added physics arrival test.
- Controller tests first failed for missing automatic advancement, tap advancement and held-Space behavior, then passed after implementation.
- `npm run playtest -- --url http://127.0.0.1:5175` passed 12 turns at 60.5 fps on Metal with no browser errors.
- `node tmp/check-navigation.mjs` passed real-click arrival, Space pause, single-step, held-Space speed, release, focus loss, inventory blocking, visible-hostile manual control and newly revealed hostile interruption. Holding Space advanced six turns in 1.8 seconds. Evidence is in `tmp/navigation-browser.log` and `tmp/navigation-controls.png`.
- Foreground Chromium probes crashed at launch. The background standard playtest and browser control script both completed with exit code zero. No browser workaround was added to the project.
- Screenshots were inspected. Fine visual details and the feel of the controls still need the user's assessment.

## Conclusion
The prototype runs in the isolated worktree with local dependencies. Simulation rules and saved world structure are unchanged. Automatic travel state is session-only. The main checkout is untouched and the branch is not merged.

