# Truck grids

## Context
- Each truck's grid and base model share one outer box. The base exports a height socket per cell, and `bodyOf()` in `src/sim/body.ts` makes the physics collider a box as wide as the grid.
- Commit f03b4ca put an armor ring inside that box and moved the wheels one cell in. That took cells from inside the model, so trucks lost deck and cargo room, and the scout lost its bed.
- The reverted base models have hood holes on the old engine cells, so engines now draw beside their holes.
- The jeep, convertible and buggy have open seats. The buggy and wagon are missing from `PLAYER_CHASSIS`, so the player cannot buy them.
- The bus engine sits in the last two rows, next to the rear armor.

## Desired design
- The model owns the outer shape, the hood hole and the cab. The grid owns what each inner cell does. A test checks the E cells against each model's hood hole.
- Side armor slots are skin, outside the model. The grid is the model's columns plus one armor column on each side. Front and rear armor rows stay the model's bumper rows and span its full width.
- A mounted side plate draws thin on the model's outer face. Armor slots add no width.
- The collider comes from the base model, as boxes made by the prop shape script. Trucks hit exactly where they are drawn. `Body.half` becomes the bounds of those boxes, so shot lanes, hit width and crash sides keep their meaning.
- Wheels sit on the model's edge columns, one column in from the side armor, where the model draws them. Example scout rear: `L W D D D W R` over ` B B B B B `.
- Critical parts are the engine, cab and tank. Tier 1 parts may touch armor slots. On tier 2, the engine touches armor slots on one side at most. On tier 3, every critical part has a free or built-in cell between it and the armor on every side. Free cells there work as last-resort armor.
- The bus engine moves one row toward the center. Its model's engine hatch moves with it.
- The jeep, convertible and buggy get closed cabs with roofs. Only the cab area of their models changes. `cabOpen` becomes a closed cab part.
- The buggy and wagon join `PLAYER_CHASSIS`.
- Deck cell counts come from measurement, not a guess. Beds split into deck cells, which take guns, and plain cells, which only carry cargo.
- Out of scope, as a follow-up task: a roof gun slot on the cab. It needs a second item layer on the cab cells.

## Invariants and principles
- Models of the scout, van, courier, buggy, jeep and convertible stay as on main, except the cab area of the three open trucks. Screenshots of each go to the user.
- Every item in an old save lands on a valid cell. The 1.1 to 1.2 save step is still unreleased on this branch, so its new grid tables are rewritten, not stacked with a second step.
- Grids stay mirror-placed for wheels, as `bodyOf()` checks.
- The quality gate passes with no raised limits.

## Implementation plan
### Phase 1: measure the gun budget
- Skipped for now. Deck counts start near the old grids, and the user decides after phases 2 to 4.

### Phase 2: collider from the model
- `scripts/prop-shapes.mjs` also writes boxes for each `base_*` model to a truck shapes file, with the same hash check.
- `bodyOf()` returns those boxes and takes `half` from their bounds. `src/phys/drive.ts` builds a compound collider from them. `src/sim/crash-contact.ts` keeps using `half`.
- `cellCenter()` maps inner columns onto the model and puts armor columns on the model's outer face.

### Phase 3: grids and drawing
- Rewrite every layout and core list in `src/data/chassis.ts` with armor columns outside the model, wheels on the edge columns, E cells on the hood holes, tier buffers and the deck counts from phase 1.
- Record each base's hood hole cells in `src/render/partLooks.ts`, copied from the base script docs. Add a test that E cells match them.
- Add a test for the tier buffer rule.
- `src/three/render/vehicle.ts` reads row sockets with the column offset and draws side plates on the model face. Wheel hubs come from the wheel cells.
- Rewrite the tables in `src/three/save-migration-wheels.ts` and its test. Re-record the save shape.

### Phase 4: models and shop
- `base_bus.py`: move the engine hatch one row forward. Rebuild the model.
- `base_jeep.py`, `base_buggy.py`, `base_convertible.py`: add a closed cab with roof, leaving the rest unchanged. Rebuild and render previews.
- `cabOpen` becomes a closed cab with a new id and name. The save step renames it.
- Add `buggy` and `wagon` to `PLAYER_CHASSIS`.

## Verification
- `npm test`, `npm run quality` and `npm run playtest` pass.
- `npm run combat` with a fully gunned scout against today's scout. Duel targets from the weapon tuning still hold.
- Manual try, positive: screenshot every truck from the game camera. Engines sit in their holes, plates lie flat on the sides, and the user confirms.
- Manual try, positive: ram an NPC and a fence side-on. Contact happens where the bodies touch on screen.
- Manual try, negative: load a 1.1 save with gear on every old cell. Every item lands on a valid cell, and nothing is lost.
