# Combat interface

Goal: Players can assign weapons, read firing restrictions on the map, and follow a volley without changing driving controls or combat balance.

## Context
- Weapon assignments appear in text rows and target rings, but the map does not identify which weapons aim at each target.
- Only a range ring is drawn for the selected weapon. The forward cannon has a firing arc that is not drawn.
- Shots appear as instant lines after movement, and the next turn can start while damage text is still playing.

## Design
Use compact numbered weapon buttons with target and current-position status. Preserve per-weapon aiming and hold fire. Add an explicit all-weapons button and hide/show control, with weapon shortcuts available while hidden. Show numbered weapon markers above visible targets and a range circle or forward sector for the selected weapon. Preserve orders outside range, since movement precedes firing. Slow only combat playback by adding a projectile phase and time to read stacked damage labels. Manual commands remain locked until playback ends. Simulation results and driving controls stay unchanged.

TDD: yes for shared weapon readouts. Browser tests cover controls and playback. Visual approval remains with the user.

### Invariants
- IV1 — Driving orders, movement timing, weapon balance, and simultaneous damage rules do not change.
- IV2 — Panel and map statuses use the existing simulation queries and describe current positions, not guaranteed next-turn shots.
- IV3 — Hidden targets reveal no position or current health through combat markers or effects.
- IV4 — Weapon commands and turn advancement cannot alter an active playback.

## Plan
One implementation phase, committed as `Improve weapon targeting and combat playback`.
- `src/ui/weapons.ts` owns weapon selection controls, aiming, and the shared `getWeaponReadout(world, weapon)` query. `src/ui/weapons.test.ts` covers ready, range, arc, reload, disabled, missing, and hidden targets.
- `src/ui/host.ts` adds a playback-lock query. `src/ui/style.css` owns the compact panel layout. `src/ui/hud.ts` updates the shortcut help.
- `src/render/weaponRange.ts` owns projected range and arc drawing, using weapon definitions rather than new combat rules.
- `src/scenes/WorldScene.ts` owns input routing, target-marker lifecycle, and movement/volley/result playback. It consumes simulation queries and never changes simulation rules.
- `src/render/fx.ts` owns travelling shots, distinct cannon and machine-gun effects, impacts, and stacked shot labels.
- `src/config.ts` and `.env.example` own configurable projectile and result-read durations. The worktree `.env` supplies both.
- `tmp/combat-interface.mjs` drives real controls, checks driving preservation, hidden targets, blocked shots, split assignments, panel hiding, playback locking, and captures screenshots.

Dependencies remain scene → UI/render/sim and UI/render → sim/data. No simulation module imports presentation code. No saved-state schema changes or compatibility layer.

## Verification
Run unit tests, typecheck, the existing playtest harness, and the focused browser script. Inspect screenshots, then ask the user to confirm marker readability and combat feel.
