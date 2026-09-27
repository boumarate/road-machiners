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

## Conclusion
The prototype runs in the isolated worktree with local dependencies. Simulation rules and saved world structure are unchanged. Automatic travel state is session-only. The main checkout is untouched and the branch is not merged.

