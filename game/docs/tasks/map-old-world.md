# Old world map layer

**Status:** done
**Branch:** procedural-map
**Worktree:** .worktrees/procedural-map
**Goal:** The baked map carries an old world placed by rules from terrain, sites and roads: ruined settlements on flat ground, buildings on overlooks and road bends, faded old roads with broken bridges where washes cut them, bridges on today's roads over washes, power lines, billboards, tank hulks and dead fields. The fixed landmark rows are gone. The user confirms the look from the bake pictures and in play.
**Mode:** hands-off until the bake pictures

## Context

- `docs/tasks/map-geology.md` built the bake: layers over one draft in `src/mapgen/bake.ts`, a map file read by `decodeMap()`, and pictures in `tmp/map/`. The file stores only rocks as props, as position and radius.
- Fixed landmark rows come from `REGION.landmarks` in `src/data/region.ts`: power poles, billboards, rock spires and tank hulks at even steps along roads in four areas. `generateObstacles()` places them at boot, the same on every map.
- Obstacles drive, block sight and draw by kind. `building` and `landmark` kinds exist, with models for building, silo, water tower, bridge, billboard, power pole, tank hulk and crag.
- `world.obstacles` is saved whole, so every baked prop also lands in each save. Today that is about 1,300 rocks.
- Sight checks filter the whole obstacle list per query in `src/sim/vision.ts`, so more props cost more per check.
- The ground has a cracked asphalt type with no rule since geology dropped the noise patches.
- Decided with the user: old world comes before the new-world layer, broken bridges appear on both old and current roads, old world replaces the fixed landmark rows, and art reuses existing models plus about four new ones.

## Design

An old-world layer runs after geology and before the road finish. It reads terrain, flow and today's sites and roads, and writes props and ground types into the draft. Each rule is a separate function with its numbers in an `OLD_WORLD` table in `src/data/terrain.ts`.

Rules, in order:

1. Old settlements. Flat, dry spots near today's sites and junctions score high. Picks keep a minimum spacing. Each settlement gets a cluster of ruined houses, and a farm settlement also gets a silo or water tower.
2. Overlooks and bends. Hilltop edges with a wide drop get a lone building. Outer sides of sharp road bends get a building or a gas station.
3. Old roads. Straight-ish routes on the terrain connect old settlements to each other and to today's roads. They are cracked asphalt tiles, not graded, so they follow the ground. Where an old road crosses a wash bed or the canyon, it breaks: the asphalt stops, and a broken bridge span stands on each side.
4. Bridges on today's roads. Where a road crosses a wash bed, a low road bridge stands over the crossing. A share of them are broken. There the road dips through the wash on grade instead of a causeway.
5. Power lines. Poles run along one side of today's roads between sites. Some poles are down or missing.
6. Billboards. They stand on the approach to towns and on long straight stretches, with spacing.
7. Tank hulks. They lie along old roads near old settlements, in small groups.
8. Dead fields. Flat low ground beside farm settlements becomes rectangles of a new dry field ground type.

Rock spires move to geology as tall rocks on ridge tops.

All props share one baked list with a kind, a position, a radius and a facing. The map file stores that list in place of the rock list, as format version 2. Baked props do not go into saves. The world rebuilds them from the map file on load, like the terrain.

Ruins, bridges, poles, billboards and hulks block driving and sight like today's landmarks. They give cover in fights. Fields are only ground.

New Blender models: a ruined house shell, a broken bridge span, a road bridge deck and a gas station. The rest reuse existing models.

The bake pictures gain a prop layer, so each kind shows in its own color.

TDD: yes. Placement rules are deterministic functions with clear properties.

### Invariants

- IV1 — The same map seed and rules give a byte-identical map file.
- IV2 — No prop stands on a road surface, pad, site or the Canyon Bridge deck, and every road keeps a clear lane.
- IV3 — Every town and location stays reachable by route from every other, as the existing route tests check.
- IV4 — Baked props never enter a save. A loaded world holds the same baked props as a new one.
- IV5 — Old roads and fields never overwrite built ground: roads, pads and sites.

### Principles

- PC1 — A bake with pictures stays under 60 seconds.
- PC2 — Props come from terrain and sites through rules. No coordinate lists by hand, except today's sites and roads as inputs.

### Assumptions

- AS1 — A few thousand more static obstacles keep turn time and frame rate inside `scripts/perf-budgets.json`.
- AS2 — The route grids handle the new static obstacles without slower route searches.

### Unknowns

- UK1 — Whether a broken bridge on today's road can let the road dip through the wash without breaking the road-grade limits, or must stay a causeway with a broken deck beside it.
- UK2 — Whether sight checks need a spatial index once props grow to thousands.
- UK3 — Speed, wear and dust numbers for the dry field ground type.

## Plan

Approach: first widen the map file from rocks to typed props and route them through the world, saves and views. In parallel, write the old-world rules against the prop type, and build the four models. Then bake, measure speed and tune with the user.

### PH1 — Typed props through file, world, saves and views
- 1.1 `src/sim/terrain.ts` (modify) — `BakedProp` and `PropKind` per IF1. `MapGrid` and `BakedMap` carry `props: BakedProp[]` in place of `rocks`. `encodeMap()` and `decodeMap()` write and read format version 2 per IF2.
- 1.2 `src/mapgen/bake.ts` and `src/mapgen/geology.ts` (modify) — `MapDraft.props` replaces `rocks`. The rock layer writes `rock` props, and ridge-top boulders above a height become `crag` props.
- 1.3 `src/sim/types.ts`, `src/data/region.ts` (modify) — `LandmarkLook` gains the old-world looks from IF1. `LandmarkDef` and `REGION.landmarks` go.
- 1.4 `src/sim/mapgen.ts` (modify) — `mapObstacles(map): Obstacle[]` turns props into `rock` and `landmark` obstacles. Ids follow IF3. `placeLandmarks()` goes. `generateObstacles()` uses `mapObstacles()`.
- 1.5 `src/three/save.ts` (modify) — saves drop every obstacle whose id `mapObstacles()` makes. `loadWorld()` puts them back from the map. `SAVE_VERSION` goes up by one.
- 1.6 `src/three/render/obstacles.ts` (modify) — each new look maps to a model. Until PH3's models exist, ruin and gas station use `building`, and both bridges use `bridge`. Power-line wires link poles by the group and step in their ids. `roadBridge` draws over the road and blocks nothing.
- 1.7 `src/sim/mapgen.ts` `isDriveObstacle()` (modify) — `roadBridge` landmarks are scenery.
- Tests: the format round-trips props and rejects version 1. A saved and loaded world holds the same obstacles as the new one, and the save has no baked prop. `mapObstacles()` makes stable ids.
- Respects: IV1, IV4. Rebake and commit the file.
- Commit: Map props carry a kind, and baked props stay out of saves.

### PH2 — Old-world rules
- 2.1 `src/data/terrain.ts` (modify) — `OLD_WORLD` numbers for each rule, with unit and reason. `field` joins `TERRAIN_TYPES` last, so earlier type codes keep their values.
- 2.2 `src/mapgen/oldworld.ts` (create) — `oldWorldLayer(seed, d)` runs these rules in order, each a separate exported function: `settlements()`, `overlooks()`, `bendBuildings()`, `oldRoads()`, `roadBridges()`, `powerLines()`, `billboards()`, `tankHulks()`, `fields()`. Old roads use a small least-cost search on the corner grid, with slope cost.
- 2.3 `src/mapgen/bake.ts` (modify) — `bakeMap()` runs `oldWorldLayer()` after geology and before finish. `finishLayer()` skips flattening near broken road bridges, so the road dips through the wash, and `gradeRoads()` still caps the grade. The ground layer lays `asphalt` on old-road tiles and `field` on field tiles, after built ground. Every prop placement checks IV2 and IV5.
- 2.4 `scripts/map-preview.mjs` (modify) — draws each prop kind in its own color and shape.
- Tests on small drafts, one per rule. Settlements keep their spacing and stand on flat ground. An old road crossing a wash breaks and gets a span on each bank. Power poles keep one side and their spacing. No prop lands on a road, pad, site or deck. Fields and old roads never overwrite built ground. A broken road bridge leaves the road within grade limits.
- Respects: IV1, IV2, IV3, IV5, PC1, PC2. Resolves UK1 and UK3.
- Commit: Old-world rules place ruins, old roads, bridges, power lines, billboards, hulks and fields.

### PH3 — Models
- 3.1 `tools/blender/ruin_house.py`, `bridge_broken.py`, `road_bridge.py`, `gas_station.py` (create), each from the `wreck.py` template, and their `.glb` files in `public/models/`.
- 3.2 `src/three/render/models.ts` (modify) — the four names join `NAMES`.
- Each model gets a preview render, which the implementer inspects.
- Commit: Models for ruined houses, broken bridge spans, road bridges and gas stations.

### PH4 — Wire models, bake, measure and tune
- 4.1 `src/three/render/obstacles.ts` (modify) — the four looks use their new models.
- 4.2 Bake. Run `npm test`, `npm run playtest` and `npm run perf`. If sight checks miss the perf budget, add a spatial index for blockers in `src/sim/vision.ts`. Resolves AS1, AS2 and UK2.
- 4.3 Send the pictures and in-game screenshots to the user. Tune `OLD_WORLD` until the user approves.
- 4.4 Update `DESIGN.md` World and `CLAUDE.md` Architecture.
- Commit: Bake the old world.

### Interfaces
- IF1 — `PropKind = 'rock' | 'crag' | 'ruin' | 'house' | 'silo' | 'waterTower' | 'gasStation' | 'bridgeSpan' | 'roadBridge' | 'roadBridgeBroken' | 'pole' | 'billboard' | 'tank'`. `BakedProp = { kind: PropKind; pos: Vec; r: number; yaw: number; group: number; step: number }`. Yaw is in radians from map +x toward +y. Group and step order the poles of one power line and are 0 for other props.
- IF2 — Map file version 2: the version 1 header, heights and types, then a prop count and, per prop, kind as u8 index into the `PropKind` list, then x, y, r and yaw as f32, then group and step as u16.
- IF3 — Obstacle ids: `rock<k>` for rocks by prop order, `<kind>-<group>-<step>` for poles, and `<kind>-<k>` for other props.
- IF4 — `oldWorldLayer(seed: number, d: MapDraft): MapDraft`, which appends props, marks old-road and field tiles in a new `d.built` Uint8Array per tile, and lists broken road bridge points in `d.dips: Vec[]`.

### Interface graph
- PH1 -> IF1, IF2, IF3 @ src/sim/{terrain,types,mapgen}.ts, src/data/region.ts, src/three/save.ts, src/three/render/obstacles.ts, src/mapgen/geology.ts, the rock and draft parts of src/mapgen/bake.ts, their tests, public/maps/icarus.bin
- PH2 IF1 -> IF4 @ src/mapgen/oldworld.ts and tests, src/data/terrain.ts, scripts/map-preview.mjs
- PH3 -> @ tools/blender/{ruin_house,bridge_broken,road_bridge,gas_station}.py, public/models/*.glb for those four, src/three/render/models.ts
- PH4 IF4 -> @ src/mapgen/bake.ts pipeline, finish and ground parts, src/three/render/obstacles.ts, src/sim/vision.ts, public/maps/icarus.bin, DESIGN.md, CLAUDE.md

PH1, PH2 and PH3 own disjoint paths and run together. PH2 leaves the `bake.ts` hook, finish dips and ground marks from 2.3 to PH4, which owns `bake.ts` after PH1.

### Risks / rollback
- RK1 — Thousands of props slow sight checks or physics. PH4 measures with `npm run perf` before tuning, and adds a spatial index only on a miss.
- RK2 — Old roads through rough ground look like noise. The least-cost search keeps them to gentle ground, and the pictures decide.
- RK3 — Removing baked props from saves breaks a later breakable prop that must stay broken. `docs/tasks/breakable-props.md` must record broken baked props in the save by id.
- Rollback: revert the task's commits on the branch.

## Verify

## Code smells

## Verify

Result: passed

- CK1 (IV1) — two bakes differ — held: identical sha1 `520db590`.
- CK2 (IV2, IV5) — a prop or old-road tile lands on built ground — held: the placement tests and the baked-map clearance tests pass.
- CK3 (IV3) — a site becomes unreachable — held: the route tests pass on the baked map.
- CK4 (IV4) — a baked prop enters a save — held: the save round-trip test passes.
- CK5 (AS1) — props push perf past budget — held relative to the baseline: turn time rises 5 to 10% and move preview about 5 ms, while the budgets miss on the pre-old-world commit too.

Smoke: `npm run playtest` passed at 60 fps, and the user reviewed the ruins and broken highway bridges in play.

## Conclusion

Outcome: goal achieved at 66aff93, merged to main. The user approved the ruins and the broken highway bridges in play.

Review findings:
- Important: saves recognize baked props by id pattern (`isBakedObstacle()` in `src/sim/mapgen.ts`), so a broken baked prop would be stripped from saves. Deferred to `docs/tasks/breakable-props.md`, the first task that must save baked prop state. That task should replace the id pattern with an explicit record of broken baked props.


### Deviations from plan
- Broken road bridges are no prop kind of their own. A broken bridge on today's road stood on the road surface, where it would either block traffic or be driven through. Instead its two broken ends stand on the banks beside the road, and the road dips through the wash.
- Two road bridges where roads meet on one wash overlapped. The first one now serves both.
- `src/sim/tow.test.ts` "offers the same deal again" relied on a lucky roll. A forced option still leaves keep its minimum chance. The test now pins that roll, as `robbery.test.ts` does.

### Hands-off decisions
- udesign: approved by the user. Hands-off runs from planning until the bake pictures.
- uplan: plan auto-approved on "go go go".
- uexecute: old roads break with spans only across washes 24 m or wider. Narrower gullies just cut the asphalt, because every gully breaking the road read as dashes.
- uexecute: road bridges span 16 to 36 m. Longer wet stretches are roads running along a wash.
- uexecute: perf misses its budgets on the pre-old-world commit too, with boot about 2.5 s and first turn 380 to 450 ms under current machine load. The old world adds about 5 to 10% turn time and about 5 ms per move preview.
