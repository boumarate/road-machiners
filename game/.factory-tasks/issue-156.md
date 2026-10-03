# Issue 156 — Ship debris trail across Icarus

**Mode:** hands-off
**Goal:** On the freshly baked Icarus map, a trail of crashed-ship debris (hull plates, wing shards, escape pods, habitat cylinders and glowing power cells) runs from Podfield past Broken Wing to the Fallen Sun's north-east rim, with lone pods and plates scattered over the rest of the basin. The pieces block driving and sight like other props, and the power cells and pod beacons glow cold cyan by day and night. Confirmation needs the user to look at the day and night screenshots and the map preview from PH4.

## Context
- The issue asks for spaceship debris in the old-world bake stage: "space parts, metal, wings, pods and habitat cylinders around, some glowing parts". Triage passed it as decoration of the existing region.
- `docs/lore.md` already says engines, cargo sections and escape pods "fell across the basin, leaving a trail of wrecks and impact scars". DESIGN.md principle 8 and the World section ask for "crash wreckage" around farm fields. Today the only ship pieces outside sites are the Fallen Sun territory's own debris (`TERRITORIES['fallen-sun'].debris`, inside the crater) and the Broken Wing hoop.
- The ship-related places lie in the north-east and middle of the map: Fallen Sun (tiles 320,270, radius 44), Broken Wing (road at 350,165), Podfield (391,105), and Nose town (510,175), which draws a `ship_nose` model. The canyon runs north to south at region x 86 to 92 between Podfield and Nose.
- `oldWorldLayer()` in `src/mapgen/oldworld.ts:39-52` runs the old-world rules in order, each from `ruleRng(seed, rules.seedOffset)` with numbers in `OLD_WORLD` in `src/data/terrain.ts`. `tankHulks()` (`oldworld.ts:767-787`) is the closest existing rule: a few props near a line, each tried `placeTries` times through `place()` and left out when it does not fit.
- `place()` (`oldworld.ts`) keeps a prop inside the map margin, off New World roads with a gap, clear of every site by `siteClearance` 8 tiles, off decks, off cliffs and apart from every placed prop. It does not check old asphalt roads (`BUILT_OLD_ROAD` in `d.built`).
- Baked props become `landmark` obstacles with `look` = prop kind and id `${kind}-${index}` (`mapObstacles()` in `src/sim/mapgen.ts:29-43`). They collide, block routes and block sight by their model's boxes from `src/data/prop-shapes.json`. `LANDMARK_MODELS` and `MODEL_RADIUS` in `src/sim/mapgen.ts:155-196` map a look to a model and its reference radius.
- `PROP_KINDS` in `src/sim/terrain.ts:117` is the stored order of kinds in the map file. New kinds go last.
- The reactor is the only glowing prop. `buildProp()` in `src/three/render/obstacles.ts:243-251` calls `lightCore()`, which makes the model's `glow` material emissive in `PAL.reactorGlow` (green, 0x7cff5a) and adds a pulsing `PointLight`. The reactor's glow marks a health hazard.
- Out-of-sight props drain to grey through the scope's shader patch on `outgoingLight`, which includes emissive light (`src/three/render/scope.ts:206-208`).
- The map holds 2764 baked props today. 296 car wrecks and every other non-rock, non-tree prop are drawn as one model clone each, detached outside the view by the render scope.
- Adding `shipWing` (issue 114, commit 72374375) added a prop kind and rebaked the map with no save migration. Baked props are not saved, and a save on another map hash goes through the rescue screen (`docs/architecture/saves.md`).
- The issue has no reference images.

## Reference images
The issue has no reference images, so the design takes nothing from one and the plan has no image comparison. The `blender-image-to-3d` skill is not used, since no image shows the models. The models follow `docs/art.md` and the existing ship pieces' style (`hull_chunk.py`, `reactor.py`): cold metal, rust and soot from the palette.

## Design
A new old-world rule, `shipDebris`, lays a debris trail and a sparse basin-wide scatter of ship pieces during the bake. Four new prop kinds with new low-poly models carry the pieces the issue names. Existing `hullChunk` gives the hull metal. The debris is cover and scenery only: no loot, no hazard, no breaking.

### Where the pieces lie
- **Trail.** `OLD_WORLD.shipDebris.trail` is an authored polyline in region points: north-east of Podfield, south of Podfield, south of the Broken Wing road, and the Fallen Sun's north-east rim. It stays west of the canyon, so no piece blocks the canyon floor. Starting points are region (81,12), (79,26), (72,37), (66,44.5). PH4 checks them on the map preview and may move them, noting old and new points in the comment.
- **Impact clusters.** Clusters stand every `clusterStep` tiles along the trail, each shifted by up to `clusterStep / 3` along and `sideSpread` tiles across it. A cluster holds `pieces` drawn from the trail's weighted look table, each within `clusterReach` tiles of its centre. A trail piece faces the trail's heading turned by up to `yawJitter`, so the wreckage reads as a line from the fixed camera. A pod or a power cell faces at random.
- **Strays.** `strays.count` single pieces are drawn uniformly over the map from their own weighted look table: mostly pods, some hull plates and a few power cells. Escape pods came down anywhere, as the lore says.
- **Placement.** Every piece goes through `place()` and also keeps its footprint off old asphalt road tiles. A piece that fails `placeTries` draws is left out, as tank hulks are. The rule runs last in `oldWorldLayer()`, after fields, so no other old-world rule's layout moves. Debris may lie on dead fields, which DESIGN.md principle 8 asks for. The new-world layer and the territories run after it and keep clear of it.
- **Seed.** The rule draws from `ruleRng(seed, 7009)`, its own stream.

### Pieces
| Kind | Model | Size | Notes |
|---|---|---|---|
| `escapePod` | `escape_pod` | capsule about 4.5 m long, 2.4 m across, nose dug in, hatch open | a small beacon window in `ship_glow`. Low enough to see over |
| `habitat` | `habitat_cylinder` | ring-ribbed cylinder lying on its side, about 16 m long, 7 m across, one end torn open | blocks sight. The biggest piece, at most one per cluster |
| `wingShard` | `wing_shard` | torn wing slab about 14 m by 6 m, one edge dug in, the tip about 4.5 m up, with lattice under it | blocks driving under it. No canopy |
| `powerCell` | `power_cell` | cracked canister about 3 m long, tipped over, its core exposed | core rings in `ship_glow` |
| `hullChunk` | `hull_chunk` (existing) | posed at 0.8 to 1.5 tiles, so 0.53 to 1 of the model's size | the "metal" |

Each model is a Kit script in `tools/blender/` that writes a committed `.glb`. Colors come from `PAL.metal`, `PAL.metalLight`, rust and soot, and the new `PAL.shipGlow`.

### Glow
- A model's material named `ship_glow` glows. `buildProp()` paints every `ship_glow` material emissive in `PAL.shipGlow`, a cold cyan (about 0x6fe4ff), at one fixed `SHIP_GLOW.emissive` intensity. It adds no light and does not pulse.
- Cyan and steady, it reads as dead ship tech. The pulsing green with a light stays the reactor's hazard cue, so a glowing piece never looks like a hazard.
- Like every prop, the glow drains to grey out of clear sight through the existing scope patch.

### Approaches considered
- **A. Old-world bake rule (chosen).** The pieces are real props, so they give cover and ambush lines on the long open drives, and they follow the bake's determinism and placement rules. It costs a map rebake, four models and new prop kinds.
- **B. More debris in the Fallen Sun territory.** It only touches the crater, and the issue asks for the region.
- **C. Render-only scatter like pebbles.** It is cheap, but the pieces would not collide or block sight, against "everything collides by its real shape" in `docs/wiki/mechanics/world.md`.

### Non-goals
- Loot in debris. Salvage tables, refill rules and value sources stay as they are (project principle 4).
- Impact craters or scorched ground under clusters.
- Breakable debris. `BREAKABLE.kinds` stays unchanged.
- Changes to the Fallen Sun territory, Broken Wing, Podfield or Nose.

### Backwards compatibility
- New `PropKind`s go last in `PROP_KINDS`, so older map files decode.
- The rebaked map changes its hash, so saves from the old map go through the rescue screen. This matches every past rebake. `CLAUDE.md` says a new map file needs no bump.
- `LandmarkLook` widens. Baked obstacles are not saved, new kinds are not breakable, and `save-shape.json` records no look values, so no migration is needed. `npm run save:shape` must show no change.

TDD: yes for the bake rule and the glow painter, since both are deterministic code where a regression should turn CI red. no for the Blender models, which are checked by preview, size tests and screenshots.

### Invariants
- IV1 — Every `shipDebris` prop passes `place()`'s checks and covers no `BUILT_OLD_ROAD` tile.
- IV2 — The same seed gives the same debris props, and the rule draws only from `ruleRng(seed, OLD_WORLD.shipDebris.seedOffset)`.
- IV3 — Every trail piece lies within `sideSpread + clusterStep / 3 + clusterReach` tiles of the trail polyline.
- IV4 — A cluster holds at most one `habitat`.
- IV5 — On the committed map, each trail cluster places at least half its pieces, and the trail and stray totals reach at least 80% of their planned counts. A test on `TEST_MAP` fails if not.
- IV6 — No debris prop lies within the Fallen Sun or Old Orchard territory edge plus `siteClearance`, so territory layouts and their draws do not change.
- IV7 — `ship_glow` materials are emissive in `PAL.shipGlow`. A debris view adds no `THREE.Light`.
- IV8 — The new looks are not in `BREAKABLE.kinds` and are no loot spot: `spotTableAt()` and salvage never name them.

### Principles
Project principles from `docs/architecture/principles.md`:
- **1. One rulebook.** The change treats the player and NPCs alike: the props are obstacles for everyone through the existing collision, nav and sight code.
- **2. The sim owns the rules.** The views read `propPose()` and `propBoxes()`. The glow painter reads only material names and palette colors, and decides no rule.
- **3. Hot code uses an index.** The change adds no hot loop. Placement runs offline in the bake, through `place()`'s existing scan of `d.props`, about 2900 props for about 150 draws. In play, the new props join `world.obstacles` and are queried through `ObstacleBuckets` like every prop.
- **4. Value is conserved.** The change adds no source or sink of value: no loot, no salvage, no breaking (IV8).
- **5. Save facts.** No saved type changes shape. `LandmarkLook` widens, and baked props are not saved. The change adds no cache.
- **6. Same seed.** The new draws are bake draws from the map seed on stream offset 7009, apart from every other old-world rule. The change adds no sim random draw.
- **7. Fail loud.** A missing model, shape or `LANDMARK_MODELS` entry throws through the existing paths. A debris piece that does not fit is left out, as decoration is in the tank-hulk and farm rules. IV5's test catches a trail that loses most of its pieces.
- PC1 — The debris glow is cyan, steady and lightless, so it never borrows the reactor's hazard cue.

### Assumptions
- AS1 — The trail from Podfield past Broken Wing to the Fallen Sun fits the lore. `docs/lore.md` leaves the crash direction open, and the trail ties together the ship places the map already has.
- AS2 — Debris counts near those in `OLD_WORLD.shipDebris` keep the visible prop count and FPS inside `scripts/perf-budgets.json`: about 12 clusters of 4 to 7 pieces plus 30 strays, about 100 to 115 new props on top of 2764.
- AS3 — Steady emissive without a light reads as glowing at night in the current daylight model. PH4's night screenshot checks this.

### Unknowns
- UK1 — Whether the starting trail points place enough pieces where the trail crosses scree near the Fallen Sun rim and the Broken Wing road. PH4 settles it on the map preview and IV5's test.
- UK2 — Whether new obstacles on open ground cause NPC stalls. PH4's `npm run stuck` settles it.

## Plan

Approach: add the models and kinds first, so the bake rule can place real kinds with real shapes. Then add the rule and rebake, then the glow view. Verify last on the real map in the browser.

### PH1 — Models, kinds and shapes
- 1.1 `tools/blender/escape_pod.py`, `habitat_cylinder.py`, `wing_shard.py`, `power_cell.py` (create)
  - Each copies the `hull_chunk.py` shape: a `COLORS` table naming palette keys, `build(kit)`, `main()`, a fixed `SEED`, and a docstring stating the reference radius: `escape_pod` 2.4 m, `habitat_cylinder` 8 m, `wing_shard` 7 m, `power_cell` 1.6 m. The sizes are in the Pieces table. The glowing parts use a material named `ship_glow` (0x6FE4FF). Use closed boxes and cylinders, so shapes can be read. Build each, write `public/models/<name>.glb` and `tmp/<name>.png`, and look at each preview.
- 1.2 `src/render/palette.ts:40` (modify) — add `shipGlow: 0x6fe4ff`, commented as the cold glow of dead ship tech, unlike the reactor.
- 1.3 `src/sim/terrain.ts:117` (modify) — append `'escapePod', 'habitat', 'wingShard', 'powerCell'` to `PROP_KINDS`.
- 1.4 `src/sim/mapgen.ts:151-196` (modify) — add the four models to the `PropModel` union, `LANDMARK_MODELS` (the four looks to their models) and `MODEL_RADIUS` (the radii above).
- 1.5 `src/three/render/models.ts:12-68` (modify) — add the four names to `NAMES`.
- 1.6 `scripts/prop-shapes.mjs:15-29` (modify) — add the four models, then run `npm run models:shapes` to regenerate `src/data/prop-shapes.json`.
- 1.7 `scripts/map-preview.mjs:14-72` (modify) — add `PROP_LOOKS` entries: pods and power cells as `disc`, habitat and wing shard as `long`. Use a cyan for `powerCell`.
- 1.8 Tests: `src/sim/terrain-file.test.ts:40`, extend the expected `PROP_KINDS`. In `src/data/prop-shapes.test.ts`, add a size check per model: length within 20% of the table, and the habitat's top over `TERRAIN.vision.eyeHeight` × `metersPerTile` so it blocks sight. Add one test that `wing_shard` has a box starting below `PHYSICS.truckClearance` under its high tip.
- Respects: IV8 (no `BREAKABLE` change).
- Commit: `Add ship debris models and prop kinds (issue 156)`

### PH2 — The shipDebris bake rule (TDD)
- 2.1 `src/data/terrain.ts:471-616` (modify)
  - New `export type ShipDebrisRules = { seedOffset: number; trail: Vec[]; clusterStep: number; sideSpread: number; clusterReach: number; pieces: [number, number]; yawJitter: number; trailLooks: DebrisLook[]; strays: { count: number; looks: DebrisLook[] }; placeTries: number }` and `type DebrisLook = { look: PropKind; weight: number; radius: [number, number]; aligned: boolean }`. `aligned` means the piece faces the trail heading. Import `PropKind` as a type from `../sim/terrain`, as `territory.ts` does.
  - Add `shipDebris: ShipDebrisRules` to `OLD_WORLD`, with commented numbers: `seedOffset` 7009, `trail` from `scalePoint` of the four points in Design, `clusterStep` 22, `sideSpread` 6, `clusterReach` 5, `pieces` [4,7], `yawJitter` 0.5. `trailLooks` weights are hullChunk 4 r[0.8,1.5] aligned, wingShard 2 r1.75 aligned, escapePod 2 r0.6, habitat 1 r2 aligned, powerCell 1 r0.4. `strays` has count 30, with escapePod 5, hullChunk 3 and powerCell 1. `placeTries` is 8.
- 2.2 `src/mapgen/oldworld.ts:39-52` (modify) — call `shipDebris(seed, d, W.shipDebris)` after `fields(...)`.
- 2.3 `src/mapgen/oldworld.ts` (append after `fields` helpers). Functions stay short (GPC2):
  - `export function shipDebris(seed: number, d: MapDraft, rules: ShipDebrisRules): void` — builds one `RoadLine` from `rules.trail`, lays clusters, then strays.
  - `function impactCluster(d: MapDraft, rng: Rng, rules: ShipDebrisRules, line: RoadLine, s: number): void` — picks the centre and draws `pieces`. After the cluster's first `habitat`, it draws from the table without it (IV4).
  - `function placeDebris(d: MapDraft, rng: Rng, look: DebrisLook, pick: () => Vec, heading: number | null, tries: number): void` — `prop()` with yaw = heading ± jitter when aligned, else random. It goes through `offOldRoad()` and then `place(d, p, 0)`.
  - `function pickLook(rng: Rng, looks: readonly DebrisLook[]): DebrisLook` — weighted draw. It throws on an empty list or a zero total weight (principle 7).
  - `function offOldRoad(d: MapDraft, pos: Vec, r: number): boolean` — no tile in `tilesWithin(d.size, pos, r)` is `BUILT_OLD_ROAD`.
  - Reuse `RoadLine`, `ruleRng`, `range`, `sideOf`, `offset`, `facing`, `place`, `tilesWithin` (GPC8).
- 2.4 `src/mapgen/oldworld.test.ts` (modify) — write these first, against the draft fixture the file already uses:
  - Debris props keep `place()`'s rules and cover no old-road tile (IV1). Same seed, same debris. Another seed gives other debris (IV2).
  - Trail pieces lie within the IV3 reach of the trail, and aligned looks face within `yawJitter` of the heading or its reverse (IV3).
  - No cluster holds two habitats (IV4). Use a rule with the habitat weight raised to force the case.
  - `pickLook` throws on an empty table.
  - Extend the existing "keeps every prop off roads, sites and the deck" layer test so it covers the new kinds.
- 2.5 Rebake: `npm run map:bake`, and commit `public/maps/icarus.bin`. Fix the tests that pin map contents: newworld counts and territory tests. A test pinned to a count that moved gets the new count with a one-line reason. Never loosen a check.
- 2.6 `src/mapgen/oldworld.test.ts` or `src/sim/mapgen.test.ts` (modify) — real-map test on `TEST_MAP`. Each new kind is present. The IV5 shares hold, counted as trail pieces within the IV3 reach of the trail. No debris lies inside the IV6 band of either territory.
- Respects: IV1-IV6, principle 6.
- Commit: `Lay a crashed-ship debris trail and stray pods across Icarus (issue 156)`

### PH3 — Ship glow in the view (TDD)
- 3.1 `src/three/render/obstacles.ts:243-251, 319` (modify)
  - New `const SHIP_GLOW = { emissive: 1.6 }`. Tune it by eye in PH4 and keep it below `REACTOR_GLOW.emissive`.
  - `export function paintShipGlow(obj: THREE.Object3D): void` — every `ship_glow` material gets emissive `PAL.shipGlow` and intensity `SHIP_GLOW.emissive`. It reuses `eachMaterial()`.
  - `buildProp()` calls `paintShipGlow(obj)` for every prop model. A model with no such material is untouched. No light, and no entry in `this.glows`, so the reactor pulse stays reactor-only.
- 3.2 `src/three/render/obstacles.test.ts` (create) — on a hand-built group with a `ship_glow` Lambert material and a `metal` one, `paintShipGlow` sets the emissive color and intensity on `ship_glow` only. A group without the material is unchanged (IV7). If no test imports `obstacles.ts` in Node, note it in the commit and prove IV7 in PH4's browser script instead.
- Respects: IV7, PC1.
- Commit: `Draw ship debris glow in cold cyan (issue 156)`

### PH4 — Docs and verification on the real game
- 4.1 Docs (modify):
  - `docs/architecture/map.md` line 5: add the ship debris trail and strays to the old-world list, with `OLD_WORLD.shipDebris`.
  - `docs/wiki/mechanics/world.md` line 7: one sentence on the debris trail from Podfield past Broken Wing to the Fallen Sun, and lone pods across the basin, as cover with no loot.
  - `docs/VISUAL_DESIGN.md` line 15: the cold cyan glow of dead ship tech, unlike the reactor's green.
  - Run `npm run wiki` and `npm run save:shape`. Both must show no unexpected change.
- 4.2 Map preview: render it with `scripts/map-preview.mjs` and look at it. The trail must read as a line from Podfield to the Fallen Sun rim, with no piece in the canyon, on a road or in a town. Move trail points if a stretch is empty (UK1), then rebake and rerun PH2's tests.
- 4.3 Browser check, as `docs/tools.md#browser-checks` describes: a Playwright script in `tmp/` on the real GPU, with the game on `window.__ROAM__`. Take screenshots from the game camera at a trail cluster near Broken Wing, by day and at night, and at a stray pod. Check by eye: pods, a habitat, a wing shard, hull plates and a cyan power cell are visible; the glow shows at night; out-of-sight pieces grey. Check in the scene that no debris view holds a `THREE.Light` (IV7). Drive the truck into a habitat and confirm it collides.
- 4.4 Run `npm test`, `npm run typecheck`, `npm run playtest` (with `--cpu` if no GPU), `npm run perf` (AS2) and `npm run stuck` (UK2). Run the root `npm run quality`.
- 4.5 Put the screenshots in `tmp/issue-156/` and name them in the task file's Verify section for the user to confirm (Goal).
- Commit: `Document the ship debris trail (issue 156)`

### Test strategy
- Bake rule: PH2's unit tests on a draft and the real-map test on `TEST_MAP` (IV1-IV6).
- Kinds and models: the stored-kind test, shape freshness and size tests (PH1).
- Glow: `paintShipGlow` unit test, plus the PH4 scene check (IV7).
- Side effects: `npm run stuck`, `perf`, `playtest`, save tests and `save:shape` (no shape change), and the existing newworld and territory tests after the rebake.

### Order & dependencies
- PH1 blocks PH2. The bake needs the kinds, and the real-map test needs the shapes.
- PH3 needs only PH1's palette key and models. It can run after PH1, alongside PH2.
- PH4 runs last.

### Risks / rollback
- RK1 — The rebake moves new-world camps and wrecks where debris now stands, and tests pinned to them break. Mitigation: PH2.5 updates the pins with reasons. Territories do not move (IV6).
- RK2 — The new props stall NPCs or block a pass. Mitigation: `npm run stuck`. Pieces keep `place()`'s road gap, and the trail avoids the canyon. If needed, lower `pieces` or `sideSpread`.
- RK3 — The perf budget is missed. Mitigation: lower counts in data. The views are already scoped by chunk.
- Rollback: revert the commits. The previous `icarus.bin` comes back with them.

### Interfaces
- IF1 — The new `PropKind`s `escapePod | habitat | wingShard | powerCell` and their `LANDMARK_MODELS` entries (PH1). PH2 places them.
- IF2 [blocks] — `src/data/prop-shapes.json` entries for the four models. PH2's rebake and real-map test need the generated shapes.
- IF3 — `PAL.shipGlow` and the `ship_glow` material name (PH1). PH3 paints them.

### Interface graph
- PH1 -> IF1, IF2, IF3 @ tools/blender/, public/models/, src/render/palette.ts, src/sim/terrain.ts, src/sim/mapgen.ts, src/three/render/models.ts, scripts/, src/data/prop-shapes.json, src/data/prop-shapes.test.ts, src/sim/terrain-file.test.ts
- PH2 IF1, IF2 -> @ src/data/terrain.ts, src/mapgen/oldworld.ts, src/mapgen/oldworld.test.ts, public/maps/icarus.bin, tests pinned to map contents
- PH3 IF3 -> @ src/three/render/obstacles.ts, src/three/render/obstacles.test.ts
- PH4 -> @ docs/, tmp/

## Conclusion

### Hands-off decisions
- udesign: the debris goes in a new old-world rule (`shipDebris`), not in the Fallen Sun territory — the issue asks for the region, and the lore names a basin-wide trail.
- udesign: the trail runs Podfield → south of Broken Wing → Fallen Sun north-east rim, west of the canyon — it ties together the existing ship places and keeps the canyon floor open.
- udesign: the rule runs last in the old-world layer — no other old-world rule's layout moves.
- udesign: the debris is decoration and cover only, with no loot, hazard or breaking — project principle 4 needs any new value source decided on purpose, and the issue asked for none.
- udesign: the glow is steady cyan and emissive only, with no point lights — this keeps it apart from the reactor's hazard cue and adds no per-light shader cost.
- udesign: hull metal reuses `hullChunk` posed smaller instead of a new model — GPC8.
- udesign: no `blender-image-to-3d` skill — the issue has no reference image.
- uplan: plan auto-approved.

### Execution (PH1-PH4)
- Commits: `5ab13676` models and kinds, `b39d716c` bake rule and rebaked `icarus.bin`, `050e52fa` glow painter, `72f1a28c` docs and glow tuning.
- Deviations from plan:
  - Trail points: region (79,26) became (82.5,22) and (79,30). Podfield's site clearance rejected the whole cluster that the old line put 8 tiles from it. Noted in the `terrain.ts` comment.
  - `placeTries` 8 → 24. With 8 tries the trail placed too few pieces for IV5. With 24 it places 44 pieces near the trail and 104 new-kind pieces in all.
  - `offOldRoad()` checks tiles within `r + √½`, not `r`. A test caught pieces overlapping a road tile that `tilesWithin(r)` skipped.
  - `paintShipGlow` also darkens the base color (`SHIP_GLOW.base` 0.2) and uses emissive 1.0, not 1.6. At 1.6 with the full base color the cyan washed out to white under lamp light.
  - IV5's per-cluster half check is not tested, since cluster centres are drawn at bake time. The test checks trail and stray totals only.
- Full `npm test` (run file by file, not in parallel) passes: 164 files, 3070 tests. `npm run typecheck` is clean. `npm run save:shape` and `npm run wiki` show no change.
- With the default parallel `npm test` on this slow machine, seven heavy tests timed out at 30 s (tow, path, drive, newworld, npc-restraint). All pass when run serially. They are load timeouts, not failures from this change.
- Not run, as told: `playtest`, `perf`, `stuck` (UK2) and the drive-into-habitat collision check. Collision uses the existing landmark box code and the new shapes are in `prop-shapes.json`.

### Verify (for the user to confirm, Goal)
Screenshots in `tmp/issue-156/`: `cluster-day.png` (habitat, hull plates), `cell-night.png` and `crop-cell-night.png` (cyan power cell bands at night), `stray-pod-day.png`, `cluster-night.png`. The script is `tmp/ship-debris.mjs`. The map preview from `npm run map:bake` is in `tmp/map/`. I did not review the preview pictures by eye for the trail line.
