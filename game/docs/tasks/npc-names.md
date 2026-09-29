# NPC names

Mode: hands-off

## Context
- Every NPC truck shows only its template name, like "Trader caravan", in the hover panel.
- Two trucks of one template look the same, so the player cannot recognize a driver met before.

## Desired design
- Each NPC driver gets a first name and a surname at spawn, rolled from a pool with its own stream `world.nameRng`.
- The name lives in the brain as `brain.driver`, so the save keeps it with the NPC.
- `v.name` stays the template name, so events, logs and the console keep working.
- The hover panel heading shows the driver name, with the template name on the line below.
- Out of scope: names in the radio call, the log and the hit card. Faction-specific pools. Unique names.

## Invariants and principles
- The name never changes for the life of an NPC, including knockout, retreat and refit.
- The pool lives in `src/data/npcs.ts`, and sim code reads it from there.
- The roll goes through `src/sim/rng.ts` on `world.nameRng`, so it never shifts combat or NPC randomness.
- A save without `brain.driver` does not load, through a `SAVE_VERSION` bump.

## Implementation plan
### Phase 1 — names in the sim
- Add `FIRST_NAMES` and `SURNAMES` arrays to `src/data/npcs.ts`.
- Add `driver: string` to `NpcBrain` in `src/sim/types.ts`.
- Add `nameRng` to `World`, seeded in `newWorld()` by `nameStream()` in `src/sim/spawn.ts`.
- In `spawnAt()` in `src/sim/spawn.ts`, roll `driver` from `world.nameRng` over both arrays.
- Fix any test or cheat that builds a brain by hand, so tsc passes.
- Bump `SAVE_VERSION` in `src/three/save.ts` to 27 and add one line to its history comment.
- Check whether `isWorld()` validates brain fields, and add `driver` there if it does.
- Add a Vitest test: two spawned NPCs get names from the pool, and the name survives `update()`.
### Phase 2 — hover panel
- In `showInfo()` in `src/ui/hud.ts`, show `brain.driver` as the `h3` for NPCs and `v.name` as a dim line under it.
- The player truck keeps its current heading.

## Verification
- `npm test` and `npm run quality` pass.
- `npm run playtest` passes.
- Manual try, positive: hover two traders in a Playwright script and see two different names.
- Manual try, positive: save, reload, hover the same NPC and see the same name.
- Manual try, negative: hover the player truck and see no driver line and no crash.

## Result
- Done. NPCs get a saved first name and surname, and the hover panel shows it over the truck type.
- `npm test` passes: 1480 tests, 1 skipped. `npm run quality` and `npm run playtest` pass.
- Manual try, positive: two raiders showed "Ugo Sokol" and "Vera Yates" in the hover panel. After Save and reload, each showed the same name.
- Manual try, negative: the player truck still shows "Your truck" and no driver line. No page errors.

### Hands-off decisions
- uexecute: names roll from a new stream `world.nameRng` — rolling from the world stream shifted it and broke 4 seed-sensitive tow tests.
- uexecute: the name pools live in `src/data/npcs.ts` — a new data file failed the quality gate on folder fragmentation.
- uexecute: the worktree has its own `npm ci` install — a symlinked `node_modules` made Vite refuse font files.
