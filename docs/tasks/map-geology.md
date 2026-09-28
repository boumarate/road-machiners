# Map pipeline and geology layer

**Status:** design
**Branch:** procedural-map
**Worktree:** .worktrees/procedural-map
**Goal:** The map is built offline from the rough base of noise heights, roads and sites, then changed by a rule-based geology layer. The result is saved to a file and loaded at boot. Hills, washes and dunes read as varied landscape in-game. The user confirms the look from in-game screenshots.
**Mode:** interactive

## Context

- The map is 600 by 600 tiles of 4 m, with a height on every tile corner.
- `buildTerrain()` in `src/sim/terrain.ts` rebuilds heights and ground types from the world seed at each boot, in the page and in the turn worker.
- Heights are noise plus fixed landforms: the canyon, the dry river and two craters. Ground near roads and sites is flattened, then `gradeRoads()` caps road grades.
- Ground types come from slope, height and noise patches. No rule knows where water would flow or sand would drift.
- `generateObstacles()` in `src/sim/mapgen.ts` drops about 900 rocks in random clusters, 30 road wrecks and fixed roadside landmark rows.
- The user sees the landscape as bland to drive and fight around.

## Design

The map is built offline by a bake script and saved to one file. Boot, the turn worker and tests load that file. No layer runs in the game.

The bake runs a fixed pipeline over one map draft. The draft holds corner heights, tile ground types and props. Each layer is a function from draft to draft, with its numbers in its own data file.

1. Base. The current noise relief, ridges and fixed landforms, without the road flattening.
2. Geology. Grid rules run in steps, like a cellular automaton:
   - Rain. Each step adds water to every cell. Water moves downhill, picks up soil on steep ground and drops it where it slows. This cuts gullies and washes and builds fans at their mouths.
   - Slump. Ground steeper than a rest angle slides down to its lower neighbor. This makes scree slopes below cliffs.
   - Wind. Sand in loose-sand areas moves in slabs along one wind direction and piles into dune ridges.
   - Ground types. Wash beds get gravel or sand. Places where water pools and dries get salt crust or mud. Slump slopes get scree. Deposits get sand.
   - Rocks. Boulders go on cliff bases and bare ridges, and replace the random rock clusters.
3. Roads and sites. The current flattening and `gradeRoads()` run last, so roads cross washes on causeways and stay drivable.

Later tasks add the old world and new world layers between steps 2 and 3. Noise patches for asphalt and ash stay until then.

The map no longer depends on the world seed. The bake takes its own map seed. The world seed keeps driving all other randomness. A save records the hash of its map file. A save made on another map fails to load, with the existing crash screen.

The file stores heights as 16-bit integers, ground types as bytes and props as a short list. It lives in `public/maps/`. `npm run map:bake` writes it.

Each bake also writes pictures to `tmp/map/`. One is a top-down view of the whole map with ground colors, hillshade, roads, sites and rocks. The others are close-ups at 8 pixels per tile of named spots from the bake config. The spots are each site, Canyon Bridge, the dry river and a dune field. The user looks at the pictures and comments, then we tune and rebake.

TDD: yes. Layer rules are deterministic pure functions with clear properties.

### Invariants

- IV1 — The same map seed and rules give a byte-identical map file.
- IV2 — Every road and pad keeps its grade limits after all layers. The existing road-grade tests pass on the baked map.
- IV3 — The game never runs a layer. A missing or broken map file stops boot with the crash screen.
- IV4 — Rain and slump move soil and never create or destroy it, except where water leaves the map edge.
- IV5 — `src/sim/` keeps no file or network access. Loading the file happens at the boundary: the page, the worker and the Node test setup.
- IV6 — No boulder lands on a road, pad, site, bridge deck or map margin.

### Principles

- PC1 — A bake finishes in under 60 seconds on the user's laptop, so tuning stays a quick loop.
- PC2 — Each geology rule is a separate function over typed arrays, testable on a small grid.

### Assumptions

- AS1 — A map file around 1 MB is fine to commit, and each rebake adds that to git history.
- AS2 — Heights stored as 16-bit integers keep enough detail for the road grade tests.
- AS3 — No test relies on different seeds giving different maps.

### Unknowns

- UK1 — How to load the map before `newWorld()` in the page, the worker, saves and about 40 test files.
- UK2 — Whether the pictures can reuse the ground painter in `src/render/groundPaint.ts` in Node, or need their own small PNG writer.
- UK3 — How many rain, slump and wind steps give a good look inside the time limit.

## Plan

## Verify

## Code smells

## Conclusion
