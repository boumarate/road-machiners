# Breakable respawning props

**Status:** executing
**Branch:** procedural-map
**Worktree:** .worktrees/procedural-map
**Goal:** Fences and junk piles break when a truck drives into them fast enough, show as debris, and grow back after a few game days while the player cannot see their spot. Broken props stay broken across save and load. The user confirms in play.
**Mode:** hands-off until in-game checks

## Context

- Decided with the user: the new-world layer in `docs/tasks/map-new-world.md` comes first, so fences, shacks and props exist to break.
- Decided with the user: a broken prop grows back after a few game days, only while the player cannot see its spot.
- Every drive obstacle is a solid Rapier cylinder, and every truck contact with one is a crash. No sensor colliders exist yet. See `syncDrive()` in `src/phys/drive.ts`.
- Route grids stamp static drive obstacles once per obstacle list. Transient road wrecks are stamped per query instead. See `staticSet()` and `dynamicBlockers()` in `src/sim/nav/layer.ts`.
- Obstacle views sync by id each frame, so a removed obstacle disappears. Rocks are instanced once at boot instead. See `ObstacleViews.sync()` in `src/three/render/obstacles.ts`.
- Baked props stay out of saves and are rebuilt from the map file on load, per `docs/tasks/map-old-world.md`. A broken baked prop must therefore be saved by id, or it comes back on reload.
- Saves recognize baked props by id pattern in `isBakedObstacle()` in `src/sim/mapgen.ts`. A broken baked prop needs an explicit saved record instead, or the save strips it.
- Looted road wrecks are replaced only beyond the player's gray vision, in `turnOverRoadWrecks()` in `src/sim/salvage.ts`. This is the precedent for regrowth out of sight.

## Design

Fences and junk piles are breakable. Shacks, ruins, wrecks, rocks and every other prop stay solid.

- A truck that hits a breakable prop at `BREAKABLE.breakSpeed` or faster breaks it. The prop's colliders go at once, so the truck drives on through. The hit costs the truck `BREAKABLE.slowdown` of its speed and a small scrape of `BREAKABLE.damage` on the part that hit. Slower, the prop holds like any wall.
- A broken prop leaves the obstacle list and joins `world.broken` as `{ obstacle, turn }`. It keeps the whole obstacle, so it can come back unchanged.
- Debris draws where a broken prop stood: its pieces tipped flat on the ground. Debris blocks nothing.
- Each day, a broken prop grows back once `BREAKABLE.regrowDays` have passed and its spot lies beyond the player's gray vision, like looted road wrecks in `src/sim/salvage.ts`.
- Saves hold `world.broken`. On load, baked props come back from the map file except the broken ones. That is the explicit record of broken baked props the old-world review asked for.
- Route grids mark breakable props as costly cells, not blocked ones. Careful NPCs mostly go around. Careless ones smash through. Far NPCs without physics break a breakable prop they drive into.
- Numbers live in `BREAKABLE` in `src/data/rules.ts`.

TDD: yes.

### Invariants

- IV1 — A prop is either in `world.obstacles` or in `world.broken`, never both.
- IV2 — A loaded world holds the same obstacles and broken props as the saved one.
- IV3 — A broken prop grows back only beyond the player's gray vision.
- IV4 — Only fences and junk piles ever break.

## Plan

### PH1 — Sim rules, saves and debris
- 1.1 `src/data/rules.ts` — `BREAKABLE`: kinds, breakSpeed in m/s, slowdown share, damage, regrowDays, each with unit and reason.
- 1.2 `src/sim/types.ts` — `World.broken: { obstacle: Obstacle; turn: number }[]`.
- 1.3 A sim function `breakProp(world, id, vehicleId)` — moves the obstacle to `world.broken`, applies slowdown and damage, and logs an event. A daily `regrowBroken(world)` in the salvage renewal. Both in existing sim files, within quality limits.
- 1.4 `src/three/save.ts` — saves and loads `broken`, and rebuilds baked props minus broken ones. `SAVE_VERSION` goes up by one.
- 1.5 `src/three/render/obstacles.ts` — debris views for broken props, synced by id.
- Tests: IV1 to IV4, regrow only out of gray vision and after the days, save round-trip with a broken baked fence.
- Commit: Fences and junk break into debris and grow back out of sight.

### PH2 — Physics, routes and far NPCs
- 2.1 `src/phys/drive.ts` — a contact with a breakable prop at `breakSpeed` or more reports a break for that prop and removes its colliders in the same turn, so the truck drives on. The turn result carries the breaks, and the turn pipeline calls `breakProp()` for each.
- 2.2 `src/sim/nav/layer.ts` — breakable props stamp costly cells instead of blocked ones, at `BREAKABLE.routeCost`.
- 2.3 `src/sim/far.ts` — a far NPC whose step crosses a breakable prop breaks it.
- Tests: a fast truck breaks a fence and passes, a slow one stops, routes cross a fence line only at a cost, and a far NPC breaks a fence on its route.
- Commit: Trucks smash through fences and junk, and routes weigh them as costly.

### Interfaces
- IF1 — `breakProp(world: World, id: string, vehicleId: string): void`, in the sim, owned by PH1.
- IF2 — `BREAKABLE` in `src/data/rules.ts` and `isBreakable(o: Obstacle): boolean` next to `isDriveObstacle()`, owned by PH1.

### Interface graph
- PH1 -> IF1, IF2 @ src/data/rules.ts, src/sim/types.ts, src/sim/mapgen.ts (isBreakable), the sim file holding breakProp and regrow, src/three/save.ts, src/three/render/obstacles.ts, their tests
- PH2 IF1, IF2 -> @ src/phys/drive.ts, src/phys/turn.ts, src/sim/world.ts turn pipeline, src/sim/nav/*, src/sim/far.ts, their tests

## Verify

## Code smells

## Conclusion
