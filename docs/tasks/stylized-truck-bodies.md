# Stylized truck bodies

**Status:** validating
**Branch:** stylized-trucks
**Worktree:** .worktrees/stylized-trucks
**Goal:** At the default game zoom, the user can tell each chassis apart by its silhouette, and the scout reads as a stylized Hilux. The user signs off on screenshots.
**Mode:** interactive

## Context
- Every chassis draws from the same hood, cab and bed cell pieces in `src/three/render/vehicle.ts`, so each truck is a pickup of a different size.
- Chassis differ in the view only by grid size, `PHYSICS.bodies` half height and wheel size.
- Zone pieces carry small details: rivets, bars, slit plates and rust patches. At the default zoom they blur into noise.
- The player paint 0x9c7a3e sits close to the sand color, so the player truck has low contrast against the ground.

## Design

Each chassis gets one base model and takes parts from the shared kit.

- The base is a whole-body Blender model per chassis, `tools/blender/base_<chassis>.py` into `public/models/base_<chassis>.glb`. It gives the vehicle its real shape from a real-world reference.
- The base fills the chassis grid footprint: rows x 0.65 m long, columns x 0.484 m wide. Its origin is the collider center, so the drawn body matches the collider. Only bumpers reach past the footprint.
- The base carries the paint panels, glass, headlights, skirt and wheel arches. Material `paint` takes the faction top color, `trim` the faction cab color, and `light` the lamp material.
- The base exports one socket per grid row, `row<y>`, at the height where items stand on that row. An item across rows stands on the highest one.
- The base exports a `bay` socket. A mounted engine stands there and shows through a hood cutout over the chassis engine cells. Other engines stand on their row surface.
- The kit stays shared across all chassis: weapons, engines, cargo, armor, wheels, bumpers and goods. Parts keep snapping to grid cells.
- Wheels stay kit parts on the physics mounts, so steering, suspension and damage still show.
- Mounted armor plates hang on the outside of the base sides. Rams replace the kit bumper, as now.
- The per-cell zone pieces and `zones` in `src/data/chassis.ts` go away once every chassis has a base.

Stylized style, set on the scout base first and then reused:

- Big flat paint panels and chunky slabs, readable at the default zoom.
- No rivets, bars, rust decals or other detail under about 10 cm.
- Few strong color blocks: paint body, dark glass band, bright lamps, dark underbody.
- Silhouette traits of the reference vehicle get exaggerated a little.

Order: scout base in the new style, iterated on screenshots until the user signs off. Then one base per remaining chassis, each from a reference the user sees first. Proposed references:

- hauler: GAZ-66 cab-over truck with a canvas bed.
- buggy: Meyers Manx dune buggy with a roll cage.
- wagon: Dodge WC-51 weapons carrier.
- courier: Baja Beetle.
- van: Chevy G20 van.
- longbed: ZIL-130 flatbed with stake rails.
- carrier: Cadillac Gage V-100 Commando armored car.
- tractor: Kenworth W900 semi tractor.

Out of scope: restyling kit parts such as weapons. That follows after the scout base sign-off, as its own step. Chassis grids, physics bodies and wheel cells stay as they are.

TDD: no (visual work, checked on screenshots and by the user; boot checks cover sockets and footprint)

### Invariants
- IV1 — Each base fits its chassis collider footprint, except bumpers. The view throws on a base whose bounds leave the footprint.
- IV2 — Each base has a `row<y>` socket for every grid row and a `bay` socket. A missing socket stops boot.
- IV3 — Every chassis has a base. A chassis without a base stops the build.
- IV4 — Physics, chassis grids and saves stay unchanged.

### Principles
- PC1 — A base script states its chassis grid size and reference vehicle in its docstring.
- PC2 — Style constants shared by all bases live in one Blender helper file.

### Assumptions
- AS1 — Per-row stand heights are enough. No chassis needs different heights across one row.
- AS2 — Hanging plates outside the base reads well enough without cutting the body side.

### Unknowns
- UK1 — Whether chassis without a base keep the old cell pieces during the task, or show a plain box until their base lands.

## Plan

Approach: add the base path next to the old cell builder, prove it on the scout, then move every chassis over and delete the old builder. UK1 resolved: chassis without a base keep the old cell pieces until PH4, so the game stays playable.

### PH1 — Base path and scout base
- 1.1 `tools/blender/parts_common_base.py` (create): shared style colors and slab sizes (PC2). `row_sockets(kit, chassis rows, heights)` adds `row<y>` sockets. `check_base(kit, rows, cols, half_height)` raises when the body leaves the footprint, bumpers excluded (IV1).
- 1.2 `tools/blender/base_scout.py` (create): stylized 1988 Hilux on the 5 x 8 scout grid, half height 0.45. Hood with a cutout over the engine cells, pickup cab, sunk bed, skirt with arches at the wheel cells, headlights in `light`. Body sides stand a few cm inside the footprint, so hung plates cover them without z-fighting. Sockets `row0`..`row7` and `bay` (IV2).
- 1.3 `src/render/partLooks.ts`: `BASE_MODELS: Partial<Record<string, ModelName>>` maps chassis id to base model.
- 1.4 `src/three/render/models.ts`: add `base_scout` to `NAMES`.
- 1.5 `src/three/render/vehicle.ts`: `rebuild()` calls `buildBase()` when the chassis has a base, else the old `buildFrame()`. `buildBase()` places the base at the collider center, throws if its bounds leave the footprint (IV1), swaps `light` to the lamp material, tints `paint` and `trim`, and places kit bumpers unless a ram covers the cell. Items stand on the highest `row<y>` socket over their rows. Mounted engines on engine cells stand on `bay`. Plates hang at the footprint sides.
- Commit: Draw the scout from one stylized base model with kit parts on its row surfaces

### PH2 — Scout style iteration
- Render the scout alone and in the game at the default zoom with `tmp/solo-chassis.mjs` and `tmp/far.mjs`. Show the user and adjust `base_scout.py` and the shared style file until the user signs off.
- Commit per accepted round.

### PH2 outcome
- User signed off the scout style after two rounds: af29358. Added in PH2: weapons below the base top stand on a `wmount_riser` post, and row sockets carry the surface front edge so roof items stay behind the windshield.

### PH3 — Base per remaining chassis
- For each of hauler, buggy, wagon, courier, van, longbed, carrier and tractor: confirm the reference with the user, write `tools/blender/base_<id>.py` on its grid and physics half height, add it to `NAMES` and `BASE_MODELS`, screenshot it next to the scout.
- Commit per chassis.

### PH4 — Remove the cell builder
- 4.1 `src/three/render/vehicle.ts`: delete `buildFrame`, `buildSkirt`, `fender`, zone helpers and the no-base branch. A chassis without a base throws (IV3).
- 4.2 `src/data/chassis.ts`: delete `zones` and `Zone`.
- 4.3 Delete the zone piece scripts and glbs no longer used: hood, cab, bed, side, door, nose, tail, tailgate, fender, deck tile. Remove them from `NAMES`.
- 4.4 `CLAUDE.md` Art section: describe base plus kit instead of zone pieces.
- Commit: Replace the zone cell pieces with per-chassis base models

### Test strategy
- Boot checks cover IV1 to IV3. `npm test` and `npm run typecheck` after each phase cover IV4. `npm run playtest` after PH1 and PH4.

### Risks / rollback
- RK1 — Kit parts placed from row sockets may float or sink on some bases. Screenshots per chassis in PH3 catch it.

## Verify

Result: passed

- CK1 (IV1) — every base fits its footprint: `check_base` passed in all nine Blender builds, and `checkBaseFits` threw on none in the in-game renders — held.
- CK2 (IV2, IV3) — every chassis has a base with all row and floor sockets: `partLooks.test.ts` checks `baseModel` per chassis, and solo renders of all nine booted without a missing-socket error — held.
- CK3 (IV4) — physics, grids and saves unchanged: the diff touches no `src/sim`, `src/phys` or `physics.ts`, and `chassis.ts` loses only `zones`. 470 tests and the typecheck pass after merging main — held.
- CK4 — a weapon on a low row clips the cab: a second autocannon on the hauler bed row stands on a riser at the roof height — held.
- CK5 — a roof weapon overhangs the raked windshield: the scout mount now sits behind the roof front edge — held.

Smoke: `tmp/lineup.mjs` renders all nine chassis in four factions at the default zoom with no page errors.
Notes: `npm run playtest` fails on FPS: 19 to 19.5 against a 20 floor, with load average 9. The same playtest on main at bd56835 gave 5.5 FPS at the same time, so the machine sets the number. No page errors or crash screen appeared.

## Conclusion

Outcome: all nine chassis draw from their own stylized base model with the shared kit on top, at a7f39d0. The goal needs the user to sign off on `tmp/lineup-merged.png`.

Invariants:
- IV1 — `check_base` in Blender and `checkBaseFits` in the view both enforce the footprint.
- IV2, IV3 — `socket()` throws on a missing row or floor socket, `baseModel()` throws on a chassis without a base, and `partLooks.test.ts` covers every chassis.
- IV4 — no change under `src/sim`, `src/phys` or `physics.ts`. `chassis.ts` only loses `zones`.

### Assumptions check
- AS1 — held. Every base reads well with one stand height per row. Two bases have small clips at row edges, listed below.
- AS2 — held in the carrier and scout renders. Plates hang outside the base sides with no z-fighting.

### Unknowns outcome
- UK1 — resolved. Chassis without a base kept the old cell pieces until PH4 removed them.

Plan adherence: PH2 added the weapon riser and roof front edges on user feedback. `BASE_MODELS` became a full `Record` behind `baseModel()` once every chassis had a base.

Review findings: none at confidence 80 or above.

Future work:
- Share the helpers the base scripts copy: a length-wise loft, a partial arch outline and a half-ring fender.
- Small clips from the agents' reports: the hauler roof hatch rim, the tractor fifth-wheel plate and the courier rear rails can touch items by up to 0.1 m.
- Van core parts sit hidden inside the closed box, so their damage never shows.
- Player paint 0x9c7a3e still blends with the sand.

Verified by: user sign-off on the scout style, and solo renders of all nine chassis.
