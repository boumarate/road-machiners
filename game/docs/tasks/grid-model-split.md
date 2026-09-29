# Grid and model split

## Context
- The grid has two jobs today. It is the balance layout: slots, armor lanes and what shields what. It is also a physical map, where each cell is a fixed 0.484 by 0.65 m patch of the base model.
- The second job causes every look bug so far: engines beside their hood holes, guns floating over gaps, wheel hubs tied to wheel cells. A grid tweak for balance breaks the look.
- The physical ties sit in four places:
  - `cellCenter()` and the wheel hubs in `src/sim/body.ts`.
  - The per-cell `row<y>_<x>` and `floor<y>_<x>` sockets, risers and plates in `src/three/render/vehicle.ts`.
  - The fixed cell size in `locateCrashContact()` in `src/sim/crash-contact.ts`.
  - The exact `HOOD_HOLES` test in `src/render/partLooks.ts`.
- Armor lanes, hit width and the collider already use the model's own size.
- The riser test in `src/three/render/gunRisers.test.ts` fails on the tractor. Two deck cells sit over an empty gap beside the hood.

## Desired design
- The grid is logical only. It holds cells, letters, items and armor lanes, and knows no meters. The inventory draws it with square cells.
- The model owns everything physical: the collider, the wheel positions, where the engine is drawn, and the surfaces parts stand on.
- One projection links them. It stretches the grid over the model's footprint. Inner cells spread evenly over the model's top. Armor ring cells land on the model's outer faces. Nothing else converts between cells and meters.
- Engine: drawn at the model's engine anchor, the center of its hood hole on the bay floor. The E cells only place it in the inventory.
- Wheels: physics wheel positions are per-model data, fixed at today's values. Grid wheels are parts that take cells and hits. A grid wheel breaks the physics wheel of its corner of the truck.
- Standing parts: the base model's top surface is baked into a height map, next to its collision boxes. A part stands on the highest point under its projected footprint, so it never floats or sinks. A gun over the cab stands on the cab roof.
- Armor plates lie flat on the model's outer faces over their projected span.
- Loose correspondence tests replace exact ties:
  - E cells project into the half of the truck that holds the hood hole.
  - Each grid wheel lies in its corner of the truck.
  - Every inner cell projects inside the model's outline.
- Out of scope, as the next task: 2-cell wheels and bigger guns. After this split they are data changes plus a save step.

## Invariants and principles
- Models do not change. The per-cell sockets may stay in the models, but no code reads them.
- The logical grid does not change, so saves need no step.
- Physics wheel positions and the collider stay exactly as today. A test compares them with values recorded before the change.
- The sim never imports render code. The projection and height map live in `src/sim/body.ts` or a sibling, as plain data.
- The quality gate passes with no raised limits.

## Implementation plan
### Phase 1: model data
- Extend `scripts/truck-shapes.mjs` to bake each base's top surface into a height map at 0.1 m spacing, with the same hash check. Also record the engine anchor: the center and floor of the hood hole, taken from today's `HOOD_HOLES` cells and floor sockets.
- Add per-look wheel positions, `wheelX` and `wheelZ`, to `PHYSICS.bodies` in `src/data/physics.ts`, at today's values. `bodyOf()` reads them instead of the wheel cells.

### Phase 2: one projection
- `cellCenter()` becomes the projection: inner cells stretched over the model's footprint, ring cells on its faces. Add `cellRect()` for an item's projected footprint, and `surfaceAt()` for the highest height map point under a rect.
- `locateCrashContact()` maps contact points to lanes through the projection, not the fixed cell size.

### Phase 3: drawing
- `src/three/render/vehicle.ts` places every item through `cellRect()` and `surfaceAt()`. It draws the engine at the engine anchor, plates on the faces, and risers from `surfaceAt()` up to clear the tallest point in front. It drops `socketName()`, `baseLevel()`, `baseTop()` and `overhang()`.
- The riser test checks that posts stand on the height map.

### Phase 4: tests and docs
- Replace the exact `HOOD_HOLES` test with the loose correspondence tests.
- Update the Art section of CLAUDE.md and the header of `src/data/chassis.ts`.

## Verification
- `npm test` passes, the riser test on the tractor included. `npm run quality` passes.
- `npm run playtest` passes.
- Screenshots of all 13 trucks with a gun on every deck cell, from two sides. No gun floats, and engines sit in their holes. The user confirms.
- Manual try, positive: move a truck's E cells and wheels in the grid, and nothing changes on screen or in driving.
- Manual try, negative: put E cells in the wrong half of a truck. The loose correspondence test fails with a clear message.
