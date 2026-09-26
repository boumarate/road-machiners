# UI and HUD

Status: done
Branch: ui-hud
Worktree: .worktrees/ui-hud
Goal: The player can drive, assign weapons, read critical resources and the event log, and use inventory and town screens through the approved compact vehicle-instrument interface in a running browser.
Mode: interactive

## Context

The approved reference is `tmp/korovan-interface.html` in the main checkout. Dashboard-style prototypes were rejected. Space Rangers, Ex Machina, Convoy, and Dredge guide the interface. Critical resources must remain visible, and the event log must remain visible. The user authorized implementation in a worktree and a separate review server.

## Design

Keep the map dominant. Use a small truck instrument, compact money/fuel/supplies/cab/driver readouts, numbered illustrated weapons with readiness and target, and a separate end-turn control. Keep the event log as a compact scrollable history. Help and detailed statistics open on request. Inventory uses the real truck grid with a truck-shaped surround, illustrated parts, and selected-part information. Town and character screens use the same restrained physical styling. No simulation, persistence, balance, or movement changes. Icons expose names on hover. Full screens share a fixed frame, and inspection panels keep a fixed footprint and anchor. Use flat charcoal and steel surfaces, ivory text, and amber accents without gradients.

TDD: yes for critical HUD readouts. Browser checks cover interactions and visual layout. Static artwork uses visual review rather than test-first development.

### Invariants

- IV1 — Critical resources and event history remain visible and use the displayed game state.
- IV2 — Existing driving, targeting, hold fire, aiming, automatic fire, and playback locks remain functional.
- IV3 — Inventory cells and drag coordinates remain aligned. Town transactions use the existing rules.
- IV4 — No simulation files or other worktrees are changed.

## Plan

One implementation phase, approved by the user's instruction to make the accepted mockup in a worktree.

- `src/ui/icons.ts` owns reusable original SVG instrument and part artwork. No external assets or packages.
- `src/ui/hud-readout.ts` owns critical display values and warning state. `src/ui/hud-readout.test.ts` verifies normal, low-resource, damage, and manual-driving values.
- `src/ui/hud.ts` owns instrument controls, critical readouts, contextual help, and the visible event log.
- `src/ui/weapons.ts` owns compact illustrated weapon controls, selected-weapon detail, and the separate end-turn button, preserving existing combat queries.
- `src/ui/inventory.ts` owns the truck-grid surround, item illustrations, and selected-item inspection while preserving existing drag/drop geometry.
- `src/ui/style.css` owns the shared physical visual style, responsive HUD placement, and modal layout. Town and character structures remain in their existing files.
- `src/three/game.ts` wires HUD buttons to the same guarded inventory, character, and driving actions used by keyboard input.
- `src/ui/hitCard.ts` renders combat odds inside the fixed vehicle inspection panel instead of following the hovered vehicle. This addition implements the user's request for stationary popups.
- `scripts/ui-playtest.mjs` owns browser regressions for persistent readouts/log, fixed modal frames, icon names, flat surfaces, and movable-item inspection. Invoke with `node scripts/ui-playtest.mjs <dev-server-url>`.
- Dependency direction remains game → UI → sim/data. Artwork does not own rules.
- Commit: `Build compact vehicle HUD and truck inventory interface`.

## Verify

- `npm ci` installed worktree-local dependencies. `npm run typecheck` passed after the popup changes.
- `npm test -- --maxWorkers=1` passed all 255 tests. The initial parallel run timed out in seven simulation/physics tests, so the suite was rerun with one worker rather than changing test limits. `npm test -- --maxWorkers=1 src/ui` passed after the popup changes.
- The initial `tmp/check-ui.mjs` browser probe passed resource visibility, event log, inventory inspection, character navigation, town purchases, garage, weapon selection/hold/hiding, turn playback locking, and viewport bounds at 1440, 1280, 1024, and 700 pixels. Screenshots are in `tmp/ui-*.png`. The revised probe passed names, absence of gradients, equal modal frames, stable weapon popup bounds, and fresh inspection values after damage.
- `npm run playtest -- --url http://127.0.0.1:5188` failed when run alongside the parallel test suite: one completed turn and 6 FPS. Rerunning without the unit suite completed 12 turns, but still failed the 20 FPS gate at 14 FPS. A controlled sequential comparison then ran the unchanged 12-turn playtest against pre-change `82c5ca7` and UI commit `35c0c18`, using identical `.env`, lockfile, dependency versions, viewport, and software-rendered Chromium settings. Baseline: 15 FPS. UI: 18 FPS. Both completed 12 turns and failed the 20 FPS gate. The gate failure predates the UI change. One comparison does not establish a performance improvement. Logs are `tmp/comparison-playtest.log` in `.worktrees/ui-hud-baseline` and `.worktrees/ui-hud`. The temporary baseline server was stopped after comparison.
- Review server: `http://127.0.0.1:5188`, launched from this worktree with `npm run dev -- --host 127.0.0.1 --port 5188 --strictPort`, log `tmp/dev-server.log`.
- The first independent reviewer could not start because the Codex account rejected `gpt-5.4`. A same-protocol retry uses the explicitly selected non-Astra `gpt-6-sol` model. The retry completed and identified two issues. A direct browser probe reproduced both: resource/log visibility was false while inventory was open, and clicking the cannon left the inspection empty. The existing modal content only repeated money, and focus/click handlers did not inspect before pointerdown started dragging. Repairs reserve room below the shared modal frame for persistent readouts/log and inspect movable items before drag begins. The same probe then passed all four checks, including no overlap with the modal. The full interaction probe and all 20 UI unit tests passed after these repairs.

## Conclusion

Goal achieved in `35c0c18`, with user visual approval. Typecheck, the 255-test suite, and targeted browser interaction checks passed. The committed browser regression also passed persistent resources/log, fixed frames, hover names, flat surfaces, and movable-item inspection. The headless performance gate remains a pre-existing failure: baseline 15 FPS versus UI 18 FPS under matched settings. The UI review server remains available. No merge or push is authorized.

## Constraints

Worktree starts from committed `82c5ca7`. Main has concurrent uncommitted simulation, terrain, and game changes which are intentionally excluded. User confirmation establishes final visual acceptance.
