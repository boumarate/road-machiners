# Collisions by model shape

**Status:** design
**Branch:** procedural-map
**Worktree:** .worktrees/procedural-map
**Goal:** Every static prop collides, blocks routes and blocks sight by its model's shape, not by a disc of its radius. A truck hits a fence along its rails, drives between a gas station's posts under its canopy, and stops against a ruin's walls. The user confirms in play.
**Mode:** interactive

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

The obstacle radius stays as a bounding circle for cheap tests: overlap during placement, spawning and which chunk draws a prop.

TDD: yes.

### Invariants

- IV1 — The view and every collision user read one pose per obstacle from `propPose()`.
- IV2 — Every prop model in use has a shape in `src/data/prop-shapes.json`, and the shape matches the current `.glb`.
- IV3 — Every town and location stays reachable by route from every other.
- IV4 — Each box lies inside its obstacle's bounding radius, so cheap radius tests never miss a collision.

### Principles

- PC1 — A shape keeps few boxes: enough to follow walls and posts, few enough for the physics step and the route stamps.

### Assumptions

- AS1 — Rapier handles a few thousand extra static box colliders without slowing the turn step much.

### Unknowns

- UK1 — The box count per model that keeps a ruin's gaps without too many colliders.
- UK2 — Whether the road wreck, which scales by a rule in `RULES.wreckRadiusScale`, needs its pose rule moved too.

## Plan

## Verify

## Code smells

## Conclusion
