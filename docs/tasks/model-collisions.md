# Collisions by model shape

**Status:** executing
**Branch:** procedural-map
**Worktree:** .worktrees/procedural-map
**Goal:** Every static prop collides, blocks routes and blocks sight by its model's shape, not by a disc of its radius. A truck hits a fence along its rails, drives between a gas station's posts under its canopy, and stops against a ruin's walls. The user confirms in play.
**Mode:** hands-off until in-game checks

## Context

- Every drive obstacle is one Rapier cylinder of its radius in `syncDrive()` in `src/phys/drive.ts`.
- Route grids stamp each obstacle as a circle with `stampCircles()` in `src/sim/nav/layer.ts`.
- Sight checks test each blocker as a circle in `hasLineOfSight()` in `src/sim/vision.ts`.
- Views turn and scale each model in `src/three/render/obstacles.ts`: by baked yaw, by a hash of the id, or to fit the radius, per kind. The sim does not know these turns and scales.
- The sim and the turn worker run without Three.js, so they cannot load models.
- Decided with the user: all static props collide by model shape. Trucks keep their grid-built bodies, and site edges keep their circles.

## Design

A script reads each prop model and writes its collision shape to one data file, `src/data/prop-shapes.json`. It reads the `.glb` in Node, rasterizes the model's solid geometry on a grid of cells half a meter across, and merges the cells into a few boxes. Each box keeps the height span of the geometry over it, so a canopy roof is a box high above the ground. `npm run models:shapes` rebuilds the file after a model changes. A test fails when a prop model has no shape or its shape is stale.

One sim function, `propPose(o)`, gives each obstacle's model, turn and scale. The views and every collision user read it, so a drawn prop and its collision always match. The turn and scale rules move from `obstacles.ts` into it unchanged.

Physics builds each prop as a compound of box colliders at its pose. Boxes that start above a truck's roof height are left out, so trucks pass under canopies and bridge decks.

Route grids stamp each box's ground outline at the pose, for boxes that reach below roof height.

Sight checks test each box whose height span covers eye height. So low fences, junk and wreck gaps leave sight open, and walls block it.

The obstacle radius stays the placement footprint. Cheap tests that must not miss a collision, like sight prefilters and which chunk draws a prop, use `propReach(o)`, the farthest corner of its posed boxes.

TDD: yes.

### Invariants

- IV1 — The view and every collision user read one pose per obstacle from `propPose()`.
- IV2 — Every prop model in use has a shape in `src/data/prop-shapes.json`, and the shape matches the current `.glb`.
- IV3 — Every town and location stays reachable by route from every other.
- IV4 — Every cheap radius test on a prop uses `propReach(o)`, the farthest posed box corner, so it never misses a collision. The obstacle radius stays the placement footprint.

### Principles

- PC1 — A shape keeps few boxes: enough to follow walls and posts, few enough for the physics step and the route stamps.

### Assumptions

- AS1 — Rapier handles a few thousand extra static box colliders without slowing the turn step much.

### Unknowns

- UK1 — The box count per model that keeps a ruin's gaps without too many colliders.
- UK2 — Whether the road wreck, which scales by a rule in `RULES.wreckRadiusScale`, needs its pose rule moved too.

## Plan

### PH1 — Shapes from models
- 1.1 `scripts/prop-shapes.mjs` (create) and `package.json` script `models:shapes` — loads each prop `.glb` in Node with the three.js glTF loader, rasterizes its triangles on a 0.5 m grid in model space, and merges cells into boxes by height span. Writes `src/data/prop-shapes.json` through a temp file and rename.
- 1.2 `src/data/prop-shapes.json` (create) — per model name: `{ hash, boxes: { x0, x1, y0, y1, z0, z1 }[] }` in model meters, x forward, y sideways, z up, where `hash` is the `.glb` file hash.
- 1.3 `src/data/prop-shapes.test.ts` (create) — every model a prop pose names has a shape, and each stored hash matches its `.glb` (IV2).
- Commit: Collision shapes from prop models.

### PH2 — One pose per obstacle
- 2.1 `src/sim/mapgen.ts` (modify) — `propPose(o: Obstacle): PropPose` per IF2. The turn and scale rules move here unchanged from `src/three/render/obstacles.ts`, with the `MODEL_RADIUS` table and hash helpers they need.
- 2.2 `src/three/render/obstacles.ts` (modify) — every prop view reads `propPose()`.
- Tests: poses equal the old view rules for each kind, and IV4 holds for every baked prop against its shape.
- Commit: Obstacles carry one pose that views and collisions share.

### PH3 — Collisions, routes and sight by shape
- 3.1 `src/phys/drive.ts` (modify) — each prop becomes box colliders at its pose, leaving out boxes above `PHYSICS.truckClearance`. Crash lookup maps every collider of a prop to its id.
- 3.2 `src/sim/nav/layer.ts` (modify) — static and transient props stamp their low boxes' ground outlines.
- 3.3 `src/sim/vision.ts` (modify) — a prop blocks a sight line where a box covering eye height crosses it.
- Tests: a truck passes a fence's end but not its middle, drives under a canopy, routes stamp an L-shaped ruin as an L, and sight passes over a fence but not a wall.
- Commit: Props collide, block routes and block sight by model shape.

### Interfaces
- IF1 [blocks] — `src/data/prop-shapes.json` as in 1.2, loaded through `propShape(model: string): ShapeBox[]` in `src/sim/mapgen.ts`. PH3 tests need real shapes.
- IF2 — `PropPose = { model: string; pos: Vec; yaw: number; scale: number }`, yaw in radians from map +x toward +y, scale uniform from model meters.

### Interface graph
- PH1 -> IF1 @ scripts/prop-shapes.mjs, package.json, src/data/prop-shapes.json, src/data/prop-shapes.test.ts
- PH2 -> IF2 @ src/sim/mapgen.ts, src/three/render/obstacles.ts, their tests
- PH3 IF1, IF2 -> @ src/phys/drive.ts, src/sim/nav/layer.ts, src/sim/vision.ts, src/data/physics.ts, their tests

## Verify

## Code smells

## Conclusion
