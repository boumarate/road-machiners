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

## Verify

Result: passed, with player confirmation of marker readability and combat pace pending.

- CK1 (IV1) — `npm test` passed 106 tests. Browser input checks preserve drive-through, shift-stop, and brake orders. The combat world exactly matches the unchanged `endTurn()` result. No simulation files changed.
- CK2 (IV2) — Eight weapon-readout tests cover ready, hold, reload, range, arc, disabled, missing, and hidden targets. Browser checks cover split targets, all-weapons selection, aimed orders, hidden-panel shortcuts, and marker restoration after modal updates.
- CK3 (IV3) — Browser checks remove hidden target details and suppress effects and extra playback time for unseen battles. Player shot events preserve sight during kill-shot playback when a new wreck changes the fog.
- CK4 (IV4) — Repeated turn, auto-fire, selection, and target clicks cannot alter an active volley. Controls remain locked through the results phase. Selecting an aim point does not trigger game shortcuts.
- CK5 — Browser checks confirm travelling shots, stacked misses and damage, destruction at impact, and an explosion anchored to the wreck. Screenshots were inspected in `tmp/combat-evidence/`.
- `npm run typecheck` passed. `node tmp/combat-interface.mjs` passed all assertions. `npm run playtest -- --out .playtest/combat` reported 10 passed, zero failed, and a frame-rate warning: median 43, fifth percentile 42. The unchanged baseline reported the same frame rates.

The kill-shot probe first failed because final-state fog hid the wrecked target before playback. The regression passes after preserving the visibility proven by player shots. Screenshot inspection also exposed an explosion scaling around the map origin, corrected by drawing it in local coordinates.

## Conclusion

Implementation: `1bff5df` on the unmerged `combat-interface` branch in `.worktrees/combat-interface`. The configured worktree is ready for a player trial with `npm run dev`.

Independent review found no targeting, playback-lock, visibility, or driving defects. It flagged that existing seed-only `.env` files cannot boot without the new timing values. Explicit required configuration is retained under the project rules, with migration instructions in `CLAUDE.md` and values in `.env.example`. The first review model was rejected by the service, and the retry completed on a different non-Astra model.

Plan addition: `CLAUDE.md` documents the required timing settings so existing checkouts can be configured without replacing their seed. Visual approval remains with the player.
