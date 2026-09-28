# New world map layer

**Status:** executing
**Branch:** procedural-map
**Worktree:** .worktrees/procedural-map
**Goal:** The baked map carries a new world placed by rules on top of the old one: shack camps with fences and junk, car wrecks, scrub that spreads from moist ground, and dirty water and toxic pools. The user confirms the look from the bake pictures and in play.
**Mode:** hands-off until the bake pictures

## Context

- The bake runs base, geology, road finish, old world, ground and rocks layers in `src/mapgen/bake.ts`. Props are typed in the map file and stay out of saves. See `docs/tasks/map-old-world.md`.
- Scrub ground comes from plain noise in `plainType()` in `src/mapgen/bake.ts`, unrelated to water or shelter.
- 3D scrub tufts in `src/three/render/scatter.ts` stand on 14% of open tiles by render noise, whatever the ground type.
- The oasis pond is the only water, and it is scenery inside a site.
- The `wreck` obstacle kind is salvage stock placed at runtime by `src/sim/salvage.ts`, so baked car wrecks need a kind of their own.
- Decided with the user: dirty water and toxic pools only slow trucks, and new-world wrecks, shacks and junk are scenery. Looting goes into `docs/tasks/ruin-loot.md`.

## Design

A new-world layer runs after the old world and before the ground layer. Each rule is a separate function, with numbers in a `NEW_WORLD` table in `src/data/terrain.ts`.

1. Scrub growth. A grid rule over tiles, run in steps like a cellular automaton. Scrub seeds on moist ground: beside wash beds, around pools and near the oasis. Each step it spreads to neighbor tiles by a chance that falls with slope and dryness. It never grows on sand, scree, roads or built ground. Scrub tiles replace the noise scrub. The 3D scatter puts tufts densely on scrub tiles and sparsely elsewhere.
2. Pools. Small basins that hold standing water after rain become dirty water. Basins next to old industrial ruins, like gas stations, tank hulks and silos, become toxic. Both are new ground types that slow trucks like mud and have their own colors.
3. Shack camps. Squatters settle in three kinds of places: just outside today's towns and oases, inside old settlements among the ruins, and at road junctions. Each camp has a few shacks, a fence line around part of it, and junk piles of barrels and tires.
4. Fences. Wooden fences also line some old fields. A fence is a row of one-tile segments, so it follows its line exactly and can later break segment by segment.
5. Car wrecks. Burnt cars lie along roads and old roads, in small groups near camps, and nose-down in wash beds.

New prop kinds: `shack`, `fence`, `junk` and `carWreck`. Shacks, junk and car wrecks block driving and sight. Fences block driving but not sight, since trucks see through the rails. New Blender models: a shack, a fence segment and a junk pile. Car wrecks reuse the `wreck` model.

TDD: yes. Each rule is deterministic with clear properties.

### Invariants

- IV1 — The same map seed and rules give a byte-identical map file.
- IV2 — No prop stands on a road surface, pad, site or the Canyon Bridge deck, and every road keeps a clear lane.
- IV3 — Every town and location stays reachable by route from every other.
- IV4 — Pools and scrub never overwrite built ground: roads, pads and sites.
- IV5 — No fence closes a site pad or a road, so no route is cut off by fences alone.

### Principles

- PC1 — A bake with pictures stays under 60 seconds on an idle machine.
- PC2 — Props come from terrain, sites and old-world props through rules. No coordinate lists by hand.

### Assumptions

- AS1 — A few thousand fence segments keep turn time and frames near today's measurements.

### Unknowns

- UK1 — The right scrub density on screen, set with the user from pictures.
- UK2 — Whether fence segments need instanced drawing for frame rate.

## Plan

Approach: the same shape as the old world. Plumbing for the new kinds and ground types, the rules and the models run in parallel. Then the layer is hooked in, baked and tuned.

### PH1 — New kinds and ground types through file, world and views
- 1.1 `src/sim/terrain.ts` (modify) — `PROP_KINDS` gains `shack`, `fence`, `junk` and `carWreck` at the end, so older kind codes keep their values.
- 1.2 `src/data/terrain.ts` (modify) — `TERRAIN_TYPES` gains `dirtyWater` and `toxic` at the end: speed like mud, their own wear, dust and colors.
- 1.3 `src/sim/vision.ts` (modify) — fences do not block sight.
- 1.4 `src/three/render/obstacles.ts` (modify) — the four looks map to models. Until PH3's models exist, shack uses `building`, fence uses `power_pole`, junk uses `crates`, and car wreck uses `wreck`. Fences face along their line.
- 1.5 `src/three/render/scatter.ts` (modify) — scrub tufts stand on `SCRUB_ON_SCRUB` of scrub tiles and `SCRUB_ELSEWHERE` of other open tiles, in place of one chance for all.
- 1.6 `scripts/map-preview.mjs` (modify) — colors and shapes for the four kinds and two ground types.
- Tests: the format round-trips the new kinds, fences leave sight open, and new ground types have distinct colors.
- Commit: New-world prop kinds and pool ground types.

### PH2 — New-world rules
- 2.1 `src/data/terrain.ts` (modify) — `NEW_WORLD` numbers per rule, with unit and reason.
- 2.2 `src/mapgen/newworld.ts` (create) — `newWorldLayer(seed, d)` runs `pools()`, `scrubGrowth()`, `camps()`, `fieldFences()` and `carWrecks()`, each exported. Pools and scrub mark tiles in `d.built` with new codes. Camps place shacks, fence segments and junk.
- Tests on small drafts, one per rule, plus IV2, IV4 and IV5 on a full draft.
- Commit: New-world rules place pools, scrub, shack camps, fences and car wrecks.

### PH3 — Models
- 3.1 `tools/blender/shack.py`, `fence.py`, `junk.py` (create) and their `.glb` files. Names join `NAMES` in `src/three/render/models.ts`.
- Commit: Models for shacks, fence segments and junk piles.

### PH4 — Hook, bake, measure and tune
- 4.1 `src/mapgen/bake.ts` (modify) — `bakeMap()` runs `newWorldLayer()` after the old world. The ground layer lays `scrub`, `dirtyWater` and `toxic` from the new marks, and plain noise scrub goes.
- 4.2 `src/three/render/obstacles.ts` (modify) — the three looks use their new models.
- 4.3 Bake, test, playtest and perf. Send pictures and screenshots to the user and tune.
- 4.4 Update `DESIGN.md` and `CLAUDE.md`.

### Interfaces
- IF1 — `PropKind` gains `'shack' | 'fence' | 'junk' | 'carWreck'`. A fence prop is one segment: r is half its length along yaw.
- IF2 — `TerrainTypeId` gains `'dirtyWater' | 'toxic'`.
- IF3 — `newWorldLayer(seed: number, d: MapDraft): MapDraft`, with `BUILT_SCRUB`, `BUILT_DIRTY_WATER` and `BUILT_TOXIC` tile codes exported from `src/mapgen/newworld.ts`.

### Interface graph
- PH1 -> IF1, IF2 @ src/sim/{terrain,vision}.ts, src/data/terrain.ts TERRAIN_TYPES, src/three/render/{obstacles,scatter}.ts, scripts/map-preview.mjs, their tests
- PH2 IF1, IF2 -> IF3 @ src/mapgen/newworld.ts and tests, src/data/terrain.ts NEW_WORLD
- PH3 -> @ tools/blender/{shack,fence,junk}.py, public/models/{shack,fence,junk}.glb, src/three/render/models.ts
- PH4 IF3 -> @ src/mapgen/bake.ts, src/three/render/obstacles.ts, public/maps/icarus.bin, DESIGN.md, CLAUDE.md

### Risks / rollback
- RK1 — Thousands of fence segments cost draw calls. PH4 measures, and instances fence segments per chunk if frames drop.
- RK2 — Scrub spread covers too much or too little. PH4 tunes with pictures.

## Verify

## Code smells

## Conclusion
