# Breakable respawning props

**Status:** design
**Branch:** procedural-map
**Worktree:** .worktrees/procedural-map
**Goal:** Light props like wooden fences break when a truck drives through them and grow back later. The user confirms in a playtest.
**Mode:** interactive

## Context

- Decided with the user: the new-world layer in `docs/tasks/map-new-world.md` comes first, so fences, shacks and props exist to break.
- Decided with the user: a broken prop grows back after a few game days, only while the player cannot see its spot.
- Every drive obstacle is a solid Rapier cylinder, and every truck contact with one is a crash. No sensor colliders exist yet. See `syncDrive()` in `src/phys/drive.ts`.
- Route grids stamp static drive obstacles once per obstacle list. Transient road wrecks are stamped per query instead. See `staticSet()` and `dynamicBlockers()` in `src/sim/nav/layer.ts`.
- Obstacle views sync by id each frame, so a removed obstacle disappears. Rocks are instanced once at boot instead. See `ObstacleViews.sync()` in `src/three/render/obstacles.ts`.
- Baked props stay out of saves and are rebuilt from the map file on load, per `docs/tasks/map-old-world.md`. A broken baked prop must therefore be saved by id, or it comes back on reload.
- Looted road wrecks are replaced only beyond the player's gray vision, in `turnOverRoadWrecks()` in `src/sim/salvage.ts`. This is the precedent for regrowth out of sight.

## Design

### Invariants

### Principles

### Assumptions

### Unknowns

## Plan

## Verify

## Code smells

## Conclusion
