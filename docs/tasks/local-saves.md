# Local saves

**Status:** done
**Branch:** local-saves
**Worktree:** /Users/boris/Documents/Korovan/.worktrees/local-saves
**Goal:** After each twentieth completed turn, reloading the game in the same browser restores that saved world, including all current world fields.
**Mode:** interactive

## Context

- The game creates a new world on each boot and keeps its plain-data state in `Game.world`.
- `Game.endTurn()` computes the new world before playback. `Game.apply()` handles changes between turns.
- No stored game format exists, so there is no prior save to migrate.

## Design

Persist the complete `World` in local storage after completed turns 20, 40, 60, and so on, counting from the initial turn. The interval is required environment config with value 20 in `.env.example`. Read the saved world on boot before building physics or views. Changes after the last save, including orders and inventory changes between turns, are intentionally lost on reload. A fixed save key and format version distinguish the data from other local storage. Invalid, incompatible, or inaccessible storage stops boot with an error instead of silently resetting progress. Whole-world serialization includes new serializable world fields in future saves without changing a field list. Old saves may need an explicit migration when the world shape changes. No new-game control, manual save, or migration framework is in scope.

TDD: no (the persistence boundary has one game caller; behavioral tests still cover save cadence, restoration, and invalid data).

### Invariants

- IV1 — A save after each twentieth completed turn contains the entire current world, not a hand-picked subset.
- IV2 — A reload restores the last saved state, not an unsaved later state.
- IV3 — An invalid save or failed storage operation produces a visible error and does not overwrite the save.

### Assumptions

- AS1 — Browser local storage can hold the serialized world in the target browser.

### Unknowns

- UK1 — The serialized world size and browser quota at the twentieth turn must be measured during verification.

## Plan

Approach: Keep persistence at the browser boundary. Serialize `World` as a whole in one versioned local-storage entry; `Game` decides when to save and when to load. No sim rule or save-field list changes.

### PH1 — Persist complete world at turn milestones

- 1.1 `src/three/save.ts:1-60` (create) — `loadWorld(storage: Storage): World | null` reads one entry, checks the envelope version and essential world structure, and throws on invalid data; `saveWorld(storage: Storage, world: World): void` writes the complete world. One key and version live here. Respects IV1, IV3.
- 1.2 `src/three/save.test.ts:1-110` (create) — test complete-world round trip with an added runtime field, missing save, invalid JSON/version/shape, and a failed storage write that retains the previous entry. Respects IV1–IV3.
- 1.3 `src/config.ts:17-29` (modify), `.env.example:1-8` (modify) — require a positive `VITE_SAVE_TURNS` integer and set it to 20 in the example; pass it from `Game` to the save decision. Respects IV1.
- 1.4 `src/three/game.ts:118-121,453-457` (modify) — load before physics/view construction, then call `saveWorld` when playback finishes and `(world.turn - 1) % CONFIG.saveTurns === 0`. Do not save between-turn changes. Respects IV1, IV2.
- Commit: `Save the full world every twenty turns`.

### Test strategy

- Run focused save tests, full `npm test`, and `npm run typecheck` in the worktree.
- Run `npm run playtest` and a browser reload probe that completes twenty turns, changes world state, reloads, then verifies restoration; check malformed storage causes the crash screen.
- Measure serialized save bytes and test local storage capacity at the milestone for AS1 and UK1.

### Risks / rollback

- RK1 — Local storage quotas differ by browser; a quota error must stop play visibly instead of claiming a save succeeded.
- RK2 — New required world fields may make older saves incompatible; version detection reports this instead of silently replacing the save. A future migration needs its own task.

Simpler alternative: put JSON calls directly in `Game`. Rejected because storage format and validation need independent tests and ownership. No existing save consumer needs migration.

## Verify

Result: passed

- CK1 (IV1) — Browser ran 20 completed turns: no save at 19, complete world saved at 20 and restored byte-for-byte after reload — held.
- CK2 (IV2) — Unsaved money change after turn 20 vanished on reload — held.
- CK3 (IV3) — Malformed browser save showed the crash screen; tests reject missing turn-critical fields and keep the previous save on failed write — held.
- CK4 (AS1, UK1) — Browser wrote and restored a 544,840-byte save without quota error — held for Chromium at turn 20; other browser quotas are not measured.
- CK5 — Final revision: `npm run typecheck`, `npm test` (251 tests), and `npm run playtest -- --url http://127.0.0.1:5175` (12 turns, 27 FPS) — held.

## Conclusion

Outcome: The browser restored the full twentieth-turn save after reload, lost unsaved changes, and showed an error for damaged saves. Commits `8244e2d` and `f3a0116`.

- IV1–IV2 — CK1–CK2 and the save-cadence tests passed.
- IV3 — CK3 passed; the reviewer found missing `nextId`, `rngState`, and `spawnTimer` checks, which `f3a0116` added.
- AS1 — Held in headless Chromium at turn 20 with a 544,840-byte save; other browsers not measured.
- UK1 — Resolved by measuring the save and successfully writing and reading it in Chromium.
- Review finding — Save cadence lacked an automated test; `f3a0116` added tests for turns 19, 20, 21, and 40.
- Deviation from plan — `saveWorld` now owns the interval check so the timing rule has a direct unit test; `Game` still invokes it only after playback.
- Future work — A change that makes a new world field required may need an explicit old-save migration. Migration is outside this task's design.
