# Performance core

**Status:** done
**Branch:** icarus-exploration
**Worktree:** .worktrees/icarus-exploration
**Goal:** `npm run perf` passes every budget on the M3 Pro, and the user confirms the game feels smooth in play.
**Mode:** interactive

## Context

Measured on an M3 Pro, 600-tile map, 6 vehicles, 515 obstacles. Scripts live in `tmp/perf/`.

- Frames hold 60 FPS at every zoom and over both towns. Draw calls reach 587 when zoomed out. Three.js frustum culling already skips offscreen meshes.
- Each turn blocks the main thread for 400-1100 ms. Route planning dominates the CPU profile.
- Each move order blocks for 150-450 ms. The path preview runs 3 physics turns, and each plans routes for every vehicle.
- The first route for a vehicle size takes about 800 ms. It builds a 1200x1200 cliff layer with 5 probes per cell.
- A warm long route takes about 60 ms. A* allocates about 19 MB of arrays per call.
- The grid cache key is a string of all 515 obstacle positions, rebuilt on every route call.
- Boot takes about 5 s. Terrain generation takes 1.7 s of it.
- Fog updates rewrite all 354 fog chunks. They run every 0.35 tiles of player movement during playback.
- The scene holds 3541 meshes. Rocks are separate meshes with no instancing.
- `src/sim/path.ts` and `src/three/render/vehicle.ts` carry uncommitted edits. They inline A* neighbours, speed up the heap and reuse ring meshes.

## Design

The game gets five performance systems. Each has a measured budget.

### Budgets

`npm run perf -- --url <dev server>` runs Chromium with the Metal GPU and fails on any budget miss. Budgets live in `scripts/perf-budgets.json`.

- End of turn: main-thread work at most 100 ms.
- Move order preview: at most 50 ms.
- Boot to first frame: at most 2 s.
- Frame time p95: at most 17 ms at the widest zoom, over a town.

In dev, a small corner panel shows frame ms, last turn ms, last preview ms and route count. `src/perf.ts` holds named timers. Sim code calls it at seams only, never inside hot loops. The timers are no-ops outside dev.

### Navigation

`src/sim/nav/` replaces the grid code in `src/sim/path.ts`. `route()` and `straightClear()` keep their signatures.

- A nav layer holds cliff flags, step costs and blocked cells for the static map obstacles. It is built once per terrain and vehicle radius. The cache key is object identity through a WeakMap, not a hash of the heights.
- Cliff probes read a per-tile cliff flag array. The result matches today's 5-probe rule.
- Dynamic blockers are wrecks and parked vehicles. Each query stamps them into a reused overlay with a generation counter. Nothing is cleared.
- A* reuses typed-array scratch memory with generation stamps. The heap stores items and keys in typed arrays.
- A uniform bucket grid indexes obstacles. Line checks read only the buckets along the segment.
- A route cache holds recent results. The key is nav layer, start cell, goal cell and a blocker signature. The cache holds 64 entries. That covers up to 20 vehicles times 3 preview turns.
- Long routes may need a coarse corridor search. That is added only if the budget fails after the steps above.

### Far NPC travel

A vehicle is far when it is more than `live radius` tiles from the player. The live radius sits in `src/data/perf.ts`. It is 40, so the physics bubble reaches 50 tiles from the player.

- Far vehicles have no Rapier body. Each turn they move along their stored route at their planned speed. They burn fuel by distance, like physics turns do.
- The route is stored on the vehicle as plain state. It is recomputed when the order changes or a dynamic blocker crosses it.
- Far vehicles never crash or ram. Combat, trade and salvage still run through the sim rules.
- A far vehicle that becomes near gets a body at its sim pose. `syncDrive` already places bodies for that case.
- Far vehicles get rest-pose frames along their trail, so the view moves them smoothly and never jumps.
- The path preview simulates near vehicles only.

### Physics terrain

A Rapier heightfield collider replaces the terrain trimesh. Snapshot and restore then copy only the height grid.

### Render scope

`src/three/render/scope.ts` owns distance culling.

- Views register static objects with a map position. The scope buckets them into terrain chunks.
- Each frame it projects the camera view onto the ground and adds a margin. Only chunks inside that area stay visible. It flips visibility only when the chunk set changes.
- Terrain, fog, obstacles, sites and site props all go through the scope.
- Rocks become one instanced mesh per chunk. Static objects set `matrixAutoUpdate` to false.
- The shadow camera fits the visible area.

### Fog and boot

- Fog updates only the chunks that hold tiles whose fog state changed.
- Terrain generation reads roads through a bucket index. Today every tile measures its distance to every road segment.

### Rejected for this task

- Running turns in a Web Worker. It fixes stalls without cutting work, and it moves Rapier across threads.
- Flow fields from each site. Far NPC travel already stores routes, so repeat work stays low.

TDD: yes. Nav, far travel and fog diffing are deterministic sim code with clear equivalence tests.

### Invariants

- IV1 — A new route never enters a cell the old grid rules mark blocked. Its cost stays within 1% of a reference A* over the same grid.
- IV2 — The same world and orders give the same turn result, near and far vehicles alike.
- IV3 — A vehicle is either near and has a Rapier body, or far and has none. The check runs at every `syncDrive`.
- IV4 — A far vehicle moves no farther per turn than its speed allows and burns fuel for that distance.
- IV5 — The render scope never hides an object inside the camera view.
- IV6 — Fog alpha after a diff update equals a full recompute.
- IV7 — `src/sim/` still imports nothing from Three.js or Rapier.

### Principles

- PC1 — Measure before and after each part with `npm run perf`. Record numbers in the task file.
- PC2 — Caches are keyed by identity or content, never by time. Every cache states its bound in code with the reason.

### Assumptions

- AS1 — Headless Chromium with Metal matches the user's browser within about 20%.
- AS2 — Static map obstacles never change after generation. Only wrecks come and go.
- AS3 — Players accept that far NPCs do not crash or ram.

### Unknowns

- UK1 — Whether the Rapier heightfield uses the same triangle diagonal as the trimesh. A mismatch changes physics tests slightly.
- UK2 — Whether long routes meet budget without a coarse corridor.
- UK3 — How NPCs that are far from the player but near each other should fight. Today physics has no part in combat, so this may be a non-issue.

## Plan

Approach: Wave 1 builds five independent parts in parallel. Wave 2 adds far NPC travel on top of the new physics terrain. Every phase records before and after numbers from `tmp/perf/` scripts or `npm run perf`.

Design changes made during planning:

- Timers stay on in production. Two `performance.now()` calls per seam cost nothing measurable.
- The shadow camera already covers a fixed 160 m square around the player, so it stays as is.
- Far routes are recomputed only when the destination changes. Far vehicles ignore blockers, so a crossing blocker has no effect.

### PH0 — Baseline commit
- Commit the pending ring-mesh reuse in `src/three/render/vehicle.ts` with `vehicle.test.ts`, and the inlined A* in `src/sim/path.ts`.

### PH1 — Perf timers, panel and budget script
- 1.1 `src/perf.ts` (create). IF1.
- 1.2 `src/sim/world.ts:124-145` (modify). Wrap the `endTurn` body in `timed('turn', ...)`.
- 1.3 `src/ui/perf-panel.ts` (create). `mountPerfPanel(host: HTMLElement): void` shows FPS, frame ms p95, and last `turn`, `preview`, `route` ms and route count. It refreshes every 500 ms.
- 1.4 `src/three/main.ts` (modify). In dev, mount the panel and expose `window.__KOROVAN_PERF__ = perfSnapshot`. Call `performance.mark('korovan:ready')` after `new Game`.
- 1.5 `scripts/perf.mjs` and `scripts/perf-budgets.json` (create), plus a `perf` script in `package.json`. It launches Chromium with Metal and reads budgets from the JSON. It measures boot from navigation start to `korovan:ready`, 5 turns of `timed('turn')`, and 4 move orders of `timed('preview')`. It measures frame p95 at zoom 0.35 over both towns through IF2. It prints a table and exits 1 on any miss.
- Commit: Add perf timers, dev panel and budget script.

### PH2 — Navigation core
- 2.1 `src/sim/nav/layer.ts` (create). `navLayer(terrain, obstacles, radius): NavLayer` holds `n`, `cliffTile: Uint8Array` per tile, `blocked: Uint8Array` per cell with cliffs and non-wreck drive obstacles, and `slow: Float32Array`. It caches by WeakMap on the terrain, then by radius and a static-obstacle key. The key is built once per obstacles array through a WeakMap. Cliff probes read `cliffTile`, giving the same result as `nearCliff`.
- 2.2 `src/sim/nav/astar.ts` (create). `findCells(layer, overlay, start, goal): Int32Array | null` reuses module-level scratch sized to `n*n`: cost, from, a generation stamp and a typed-array heap. `overlay` stamps wrecks and parked vehicles with a generation counter.
- 2.3 `src/sim/nav/buckets.ts` (create). `ObstacleBuckets` is a uniform grid of 8-tile cells over blockers. `alongSegment(a, b, reach)` returns the candidates.
- 2.4 `src/sim/path.ts` (rewrite internals). `route`, `straightClear` and `routeLength` keep their signatures. `clearLine` uses buckets and `cliffTile`. `route` wraps its body in `timed('route')` and checks an LRU of 64 routes. The key is the layer id, start cell, goal cell, radius and the blocker key.
- 2.5 `src/sim/path.test.ts` (extend). Add a reference A* over the old grid rules. On 30 seeded random pairs on the real map, checks IV1 and the equality of `straightClear` with the reference. Also checks cache hits return equal routes.
- Respects: IV1, IV7, PC2. Resolves UK2 by timing a 500-tile route.
- Commit: Rebuild route planning on cached nav layers.

### PH3 — Heightfield terrain collider
- 3.1 `src/phys/drive.ts:299-338` (modify). `addTerrain` uses `RAPIER.ColliderDesc.heightfield` over the corner grid, placed to cover the map. `terrainIndices` goes if nothing else uses it.
- 3.2 `src/phys/hills.test.ts` (extend). A downward ray cast at 200 seeded points hits within 0.05 m of `heightAt` on flat tiles. Where the diagonal differs, the hit stays within the tile's corner height range.
- Resolves UK1. Respects IV2.
- Commit: Use a heightfield collider for terrain.

### PH4 — Render scope, instanced rocks, fog diff
- 4.1 `src/three/render/scope.ts` (create). IF3.
- 4.2 `src/three/render/terrain.ts`, `src/three/render/fog.ts`, `src/three/render/sites.ts` (modify). Chunks and site roots register with the scope instead of a group. Static objects call `updateMatrix()` once and set `matrixAutoUpdate = false`.
- 4.3 `src/three/render/obstacles.ts` (modify). Rocks from map generation become two `InstancedMesh` per chunk, base and peak, with per-instance color. Wrecks, buildings and water stay individual meshes registered with the scope. Wrecks added mid-game still work.
- 4.4 `src/three/render/fog.ts` (modify). `FogView` keeps a per-tile state array. `update` computes new states, finds dirty chunks and rewrites only those. Satisfies IV6.
- 4.5 `src/three/game.ts` (modify). Call `scope.update(rig.camera)` each frame. Wrap `refreshPlan` in `timed('preview')` and fog updates in `timed('fog')`. Add IF2.
- 4.6 `src/three/render/scope.test.ts` and `src/three/render/fog.test.ts` (create). They test IV5 with a camera at the map corner and center, and IV6 after random vision changes.
- Commit: Add chunked render scope and instanced rocks; fog updates only changed chunks.

### PH5 — Faster terrain generation
- 5.1 `src/sim/road-index.ts` (create). `RoadIndex` buckets road segments into 16-tile cells. `nearestWithin(p, reach): number` returns the exact polyline distance when it is under `reach`, else `Infinity`.
- 5.2 `src/sim/elevation.ts` (modify) and `src/sim/terrain.ts:21-41` (modify). `flattenFactor` and `pickType` query the index with the reach they need. Results stay identical.
- 5.3 `src/sim/terrain.test.ts` (extend). Hash the heights and types of seed 1 at size 600 before the change. The test asserts that hash.
- Commit: Index roads for terrain generation.

### PH6 — Far NPC travel (wave 2, after PH3)
- 6.1 `src/data/perf.ts` (create). `PERF.liveMargin = 20` sets the tiles beyond sight radius where NPCs still get physics.
- 6.2 `src/sim/far.ts` (create). `isNear(w, v): boolean` is true for the player and any vehicle within sight radius plus `liveMargin`. `advanceFar(w, v): void` works in these steps:
  - It reuses `brain.farRoute` when `dest` matches, else it calls `route`.
  - It sets speed from `zoneSpeed` with fuel limits and moves along the polyline.
  - It writes pos, heading, speed and a trail of `RULES.substeps + 1` poses.
  - It burns fuel for the distance and clears the order on arrival, like `applyTurn`.
- 6.3 `src/sim/types.ts:63-73` (modify). Add `farRoute?: { dest: Vec; points: Vec[] }` to `NpcBrain`.
- 6.4 `src/phys/drive.ts` (modify). `syncDrive` keeps bodies only for near vehicles and removes the rest. `run` simulates only vehicles with bodies. It throws if a near vehicle lacks a body, per IV3.
- 6.5 `src/phys/turn.ts` (modify). `applyTurn` covers vehicles with frames. `physicsMove` calls `advanceFar` for the rest.
- 6.6 `src/three/game.ts` (modify). Vehicles with no frame use `restFrame`, which already works. Check `refreshPlan` with far vehicles present.
- 6.7 `src/sim/far.test.ts` (create). Checks IV2, IV3 and IV4, and that far vehicles arrive and that crossing into range adds a body.
- Commit: Move far NPCs along stored routes without physics.

### PH7 — Corridor search for long routes (added after wave 1, RK2 hit)
The first `npm run perf` after wave 1 missed only `turnMs`: 481 ms on the first turn, then 85-90 ms. The profile shows far NPCs planning long routes, one at 273 ms, all inside `findCells`.
- 7.1 `src/sim/nav/layer.ts` (modify). Each blocked layer also stores connected components of free cells, from one flood fill at build time. It also stores a coarse grid of 8x8-cell blocks. A block is passable if any of its cells is free, and its cost is the mean `slow` of its free cells.
- 7.2 `src/sim/nav/astar.ts` (modify). `findCells` returns null at once when start and goal sit in different components. That matches today's result for unreachable goals. For a start-to-goal distance over 32 cells, it first runs A* on the coarse grid. It then runs fine A* only inside the corridor: the coarse path's blocks plus one ring around them. If the corridor search fails, it runs the full fine search and calls `count('route-corridor-miss')`.
- 7.3 `src/sim/path.test.ts` (extend). Corridor routes cost at most 5% more than the reference. Short routes keep the 1% rule, so IV1 is relaxed only for long routes. Unreachable goals return in under 5 ms.
- Commit: Search long routes inside a coarse corridor.

### Interfaces
- IF1 — `src/perf.ts`: `timed<T>(name: string, fn: () => T): T`, `count(name: string, n = 1): void`, `perfSnapshot(): Record<string, { last: number; max: number; total: number; calls: number }>`, `resetPerf(): void`. `last` is ms.
- IF2 — `Game.debugView(x: number, y: number, zoom: number): void` centers the camera on a map point at a zoom, for scripts.
- IF3 — `new RenderScope(root: THREE.Object3D, mapSize: number)`, `add(obj: THREE.Object3D, pos: Vec, radius: number): void`, `remove(obj): void`, `update(camera: THREE.OrthographicCamera): void`. Hidden chunk groups are detached from `root`, so traversal skips them.

### Interface graph
- PH1 -> IF1 @ src/perf.ts, src/ui/perf-panel.ts, src/three/main.ts, src/sim/world.ts, scripts/, package.json
- PH2 IF1 -> @ src/sim/path.ts, src/sim/path.test.ts, src/sim/nav/
- PH3 -> @ src/phys/drive.ts, src/phys/hills.test.ts
- PH4 IF1 -> IF2, IF3 @ src/three/game.ts, src/three/render/scope.ts, src/three/render/scope.test.ts, src/three/render/fog.ts, src/three/render/fog.test.ts, src/three/render/terrain.ts, src/three/render/obstacles.ts, src/three/render/sites.ts
- PH5 -> @ src/sim/road-index.ts, src/sim/elevation.ts, src/sim/terrain.ts, src/sim/terrain.test.ts
- PH6 runs after wave 1 because it shares `src/phys/drive.ts` with PH3 and `src/three/game.ts` with PH4.

### Test strategy
- TDD for PH2, PH4 fog, PH5 and PH6. Tests come first and must fail first.
- `npm test`, `npm run typecheck` and `npm run playtest` pass after each wave.
- `npm run perf` runs after each wave. Its table goes into `## Verify`.

### Risks / rollback
- RK1 — Heightfield diagonals differ from the trimesh. Physics tests may drift slightly. Tolerances change only with a stated reason.
- RK2 — Long routes miss the budget. Measure in PH2 and add a coarse corridor only then.
- RK3 — Instanced rocks change shading. Screenshots before and after go to the user.
- Each phase is one commit and reverts alone.

## Verify

`npm test` passes 285 tests in 37 s, down from 108 s. Typecheck and `npm run playtest` pass.

| metric | before | after | budget |
|---|---|---|---|
| boot | 4.7 s | 1.98 s | 2 s |
| turn, first | 1100 ms | 121 ms | 100 ms |
| turn, later | 450 ms | 72-90 ms | 100 ms |
| move preview | 150-450 ms | 37-51 ms | 50 ms |
| frame p95 | 16.8 ms | 16.8 ms | 17 ms |

The first turn and the first preview still miss by a small margin. On the first turn, physics takes 57 ms and vision takes 40 ms.

## Code smells
- `src/render/groundPaint.ts:133` and `src/sim/mapgen.ts:87` check every road per point and could use `ROAD_INDEX`.

## Conclusion

The user confirmed in play that the game runs smoothly. The review found no correctness bugs.

- Review: the Design still said a 30-tile bubble after it grew to 50. Fixed above.
- Review: `staticSet` in `src/sim/nav/layer.ts` detects a changed obstacles array only by its length. Today this is safe for two reasons. Each turn clones the world into a new array, and wreck removal in `src/sim/combat.ts` builds a new array. A future in-place splice plus push in one turn would slip past it.
- Far NPCs still fight, trade and salvage by the sim rules. They cannot ram, crash or block.
- Far NPCs ignore corner, slope and ground slowdowns, so they may cross the map faster than trucks under physics. This is not measured yet.
- The first turn takes 121-131 ms against a 100 ms budget. The user accepted this after play.
