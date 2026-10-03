# Inhabited sites become walled fortresses

**Status:** validating
**Branch:** factory/issue-80
**Worktree:** none
**Goal:** In the running game, each of the ten inhabited sites (Bowl, Nose, Dustwell, Green Pit, Pump Station, Granary, Salvage Yard, South Lock, Scrapjaw Camp, Kiln Camp) stands behind a fortress curtain. Each curtain is circular, square or star-shaped, with towers and shut gatehouses, and its walls are at least 3x as tall as the tallest truck. Trucks collide with the wall models and with no site circle, and every gate pad still works for trucks and NPCs. In-game screenshots, placed next to the reference photos below, show the named features, and the user confirms the look. New interiors and animated elements are follow-up tasks (see Scope).
**Mode:** hands-off

## Context
- Issue 80 asks for a fortress at every inhabited site: walls at least 3x as tall as any truck, towers and a gate, on a square, circular or star outline. Trucks stay outside and use the pads. Each site gets a unique interior with at least one animated element. The model is the collider. Abandoned places are out of scope. The issue asks Design to look up medieval and modern fortification pictures.
- The first design ran as one eight-phase task. Implementation stopped after 11 min: the agent waited on background agents that hit their 600 s wait ceiling, so nothing was committed. The committee asked for a smaller deliverable, real reference photos, and in-game visual comparisons during testing.
- That run left uncommitted work in this clone, which must be kept:
  - PH1's layout: `src/data/fortress.ts` and `src/mapgen/fortress.ts`, with 74 passing tests in `src/mapgen/fortress.test.ts`.
  - PH2's 15 piece scripts: `tools/blender/fort_kit.py` and `fort_<style>_<piece>.py`. Their `.glb` files are in `public/models/`, and their previews are in `tmp/fort_*.png`.
  - The `PROP_MODELS` entries in `scripts/prop-shapes.mjs` and the regenerated `src/data/prop-shapes.json`.
  - The layout sketches `tmp/forts.png` and `tmp/fort-*.ts`.
- Every site is a `kind:'site'` circle obstacle of `site.radius` (`src/sim/mapgen.ts:53`). Rapier makes it a cylinder (`src/phys/drive.ts:138-147`), the nav grid stamps it as a circle (`src/sim/nav/layer.ts:168-173`), and `isFree()` (`src/sim/spawn.ts:226`) relies on it to keep spawns out.
- Baked props already turn a Blender model into collision boxes: `prop-shapes.json` feeds `propPose()`, Rapier, the nav grid and sight. A `fence` prop is one straight segment, with `r` as half its length. Baked props are rebuilt from the map file and never saved. The `site-*`, `bld-<town>-*` and `pond-<oasis>` obstacles are saved.
- Gates lie where roads cross the site circle, and each pad's inner edge sits on it (`src/sim/sites.ts:16-46`). Guards, NPC goals, tows, spawn, defeat and the harnesses read the gates and pads.
- Today's interiors cross the new curtain lines:
  - The town houses fill a disc to `radius - 1.2` tiles (`buildSettlement`, `src/three/render/sites.ts:169`). The town `bld-*` ring stands at 0.62-0.82 of the radius (`src/data/region.ts:337`). Bowl's star curtain comes in to about 16 of its 28 tiles.
  - The 6-tile sites reach about 4.8 tiles: palms at 4.8 (`buildOasis`), tanks at 4.3 (`buildCamp`), and an 8-tile channel at South Lock (`buildLock`). A square curtain's inner face is about 3 tiles from the center.
- The tallest truck, the tractor, reaches about 3.6 m. The pieces are built at walls 12 m, towers and gatehouses 16 m and bastions 13.2 m (`tools/blender/fort_kit.py:40-51`).
- Today's masonry pieces are dark brown with a near-black sloped base (`tmp/fort_masonry_*.png`). The palette has lighter stone in `PAL.wall.top` `0xb89a74` and `PAL.rock`.

## Reference images

The issue has no images. With committee approval, Design downloaded these from Wikimedia Commons into `tmp/refs/` (git-ignored) and inspected each one with the image Read tool. They are third-party pictures and stay out of the repo. The game uses only original models.

The issue wants the forts to read as real fortifications, not to copy one building. So each image informs named features, and the visual acceptance check (PH6) compares in-game screenshots against them. All are perspective photos: they set silhouettes, details and rough ratios, not exact sizes.

- **R1 — Bourtange star fort, aerial.** `tmp/refs/bourtange.jpg`, from https://commons.wikimedia.org/wiki/File:Luchtfoto_-_Bourtange_-_20036957_-_RCE.jpg (CC BY-SA 4.0).
  - Shows: sharp arrowhead bastions, each with two long faces and two short flanks. The curtain runs straight between bastion points. There are no towers in the re-entrant corners. A road enters through the curtain between two bastions. A wet moat follows the outline.
  - Design takes: the star outline (Bowl, South Lock), with bastions at the points and only plain wall joints at the re-entrant corners.
  - Design infers: Bourtange is low earthworks. ROAM's star walls are 12 m masonry, which the issue requires. There is no moat, because the sites stand on dry flattened ground.
- **R2 — Palmanova, aerial from the northwest.** `tmp/refs/palmanova.jpg`, from https://commons.wikimedia.org/wiki/File:Aerial_image_of_Palmanova_(view_from_the_northwest).jpg (CC BY-SA 4.0).
  - Shows: a nine-point star town seen from a high oblique angle, close to ROAM's iso camera. The town is dense inside, and one straight road enters through a gate in the curtain.
  - Design takes: from a high camera, a star fort reads by its pointed outline and the dense town inside, not by wall detail. This is the target view for the Bowl screenshot.
  - Design infers: the town interior is a follow-up task. This task keeps today's houses, fitted inside the curtain.
- **R3 — Carcassonne, aerial 2016.** `tmp/refs/carcassonne.jpg`, from https://commons.wikimedia.org/wiki/File:1_carcassonne_aerial_2016.jpg (CC BY-SA 4.0).
  - Shows: a closed ring of crenellated curtain wall with round drum towers every 30-50 m. The towers stand about 1.3-1.5x the wall height and project out past the wall face. The stone is pale, warm and weathered.
  - Design takes: the circle outline (Nose, Green Pit, Granary, Scrapjaw) with towers at regular spacing. Masonry towers become round drums that project past the curtain. The masonry color moves to pale sand stone.
  - Design infers: the restored conical roofs are left out. Crenellated drum tops read better from above. Towers stay at 16 m on a 12 m wall (1.33x), inside R3's range.
- **R4 — Bodiam Castle.** `tmp/refs/bodiam.jpg`, from https://commons.wikimedia.org/wiki/File:Bodiam_Castle_2018.jpg (CC BY-SA 4.0).
  - Shows: a square plan with round towers at the corners. Measured in the photo, the corner drum is about 2.3x as tall as it is wide. The curtain is crenellated and has only narrow slit windows. The gatehouse is two square towers with a corbelled (machicolated) parapet over the gate.
  - Design takes: the square outline (Dustwell, Pump Station, Salvage Yard, Kiln) with round corner towers in masonry, slit windows, and a corbel band under the parapet over each gatehouse.
  - Design infers: Bodiam's towers stand about twice the curtain height, which would make ROAM's towers 24 m. ROAM keeps 16 m, the R3 ratio, so the camera can still see over the towers into the interior (RK4).
- **R5 — Porte Narbonnaise, Carcassonne.** `tmp/refs/narbonnaise.jpg`, from https://commons.wikimedia.org/wiki/File:Carcassone_-_Porte_Narbonnaise_01.jpg (CC BY 4.0).
  - Shows: a fortified gate approach. Arched openings are about half the wall height. A crenellated parapet with put-log holes runs above. The masonry is pale, coursed and weathered, and a round tower stands beside the gate.
  - Design takes: the masonry gatehouse gets a pointed-arch opening about 0.5x its height, framed by two towers that stand 1 m proud of the gate face. Shut timber doors fill the arch.
  - Design infers: there is no drawbridge or moat, and the doors stay shut, as the design requires.
- **R6 — HESCO wall at Forward Operating Base Shir Ghazay, 2013.** `tmp/refs/fob.jpg`, from https://commons.wikimedia.org/wiki/File:Afghan_National_Army_takes_control_of_Forward_Operating_Base_Shir_Ghazay_131119-M-HQ478-146.jpg (public domain, US Marine Corps).
  - Shows: a modern field wall of mesh-and-fabric baskets filled with dirt, each about 1.4 m wide and tall, stacked two high. Coiled wire runs along the top, and a sandbag guard post sits under a camouflage net.
  - Design takes: the scrap style (Salvage Yard, Scrapjaw, Kiln). The lower 4 m of each scrap wall is stacked basket cells with visible mesh. Welded rust plate rises above to 12 m, with a wire coil on top. The scrap tower gets a sandbag base course and a net-draped top.
  - Design infers: the colors are rusted New World scrap from `PAL.rust`, not military tan.
- **R7 — Krak des Chevaliers, inner and outer walls.** `tmp/refs/krak.jpg`, from https://commons.wikimedia.org/wiki/File:Krak_des_Chevaliers_Castle,_Inner_and_outer_walls,_Syria.jpg (CC BY 4.0).
  - Shows: sun-bleached limestone in arid hills. Round towers are massive and nearly plain, with few openings, and the stone at the wall foot is the same as above.
  - Design takes: the masonry palette and wear for a desert setting. The sloped base keeps the same stone as the wall, a shade darker, not near-black.
  - Design infers: the Krak's concentric double wall is left out. ROAM has one curtain.

Ship metal (Nose) has no photo. It is checked against the in-game `ship_nose` and `ship_hull` models, so the walls read as the same fallen colony ship.

## Design

### Scope
This task delivers the fortress curtain at all ten inhabited sites. That covers:
- the layout
- the piece models
- the colliders
- the bake
- the save step
- a reference-driven art pass on the piece models
- interim interiors fitted inside the curtains
- the screenshot comparison

The seven abandoned sites keep their circles, edge styles and models. Site ids, names, positions, radii, kinds and services stay the same. Dustwell and Green Pit stay `kind:'oasis'`.

Three follow-up tasks deliver the unique interiors and animation. Each can ship alone after this one:
- **F1, town interiors and site motion:** the render-only `anim_<motion>_<name>` motion table, the Bowl crater with farm terraces and a wind pump, and the Nose ship-nose town with shacks and a turning radar.
- **F2, water and industry:** Dustwell and Green Pit as water pumping stations with a working pump, Pump Station with a turbine, and Granary with windmill sails.
- **F3, yard, lock and camps:** Salvage Yard with a slewing crane, South Lock replaced entirely as an irrigation sluice fort with a water wheel, and Scrapjaw and Kiln with bonfires.

The F1-F3 contents follow the first design, which the committee saw. A public commenter asked for one Sonnet 5.5 agent per location. That fits F1-F3, where each interior is an independent model, and it is noted for their plans.

### Fortress outline and the site circle
`site.radius` stops being a collider. It stays the layout bound and the gate ring. Every piece lies inside the circle. Each gate is a gatehouse whose outer face sits on the circle at the road crossing `siteGates()` gives, so gates, pads, guards, parking, tows and road paint keep working unchanged.

The curtain follows the site's shape, with a turn set in data:
- a circle: an N-gon with a tower every `circleTowerEvery` sections (R3)
- a square: corners just inside the radius, with a tower at each corner (R4)
- a star: bastions at the points and plain joints at the re-entrant corners (R1)

Where a gatehouse stands outside the curtain, a barbican of two neck walls and an inner gate joins it back to the curtain. The ground between the curtain and the circle is flattened site ground, and trucks may drive there.

### Pieces and colliders
The pieces are baked props. The layer in `src/mapgen/fortress.ts` runs last in the bake. It writes wall, tower, gatehouse, bastion and inner-gate props with new `PROP_KINDS` appended last.
- A wall stretches along its length to `2r`, like the fence rule.
- Each model's prop-shape boxes are its collider in Rapier, the nav grid and sight.
- `placeSites()` stops writing `site-<id>` for fortress sites and stops writing `bld-bowl-*` and `bld-nose-*`. Those buildings would stand on or outside the star curtain, and the town houses come from the render.
- `pond-dustwell` and `pond-green-pit` stay. Each is 2.2 tiles across the center, inside the curtain.
- `isFree()` rejects points inside a fortress site's circle.

Pieces come in three styles from one shared kit (`tools/blender/fort_kit.py`):
- masonry: Bowl, Dustwell, Green Pit, Granary, Pump Station and South Lock
- ship metal: Nose
- scrap: Salvage Yard, Scrapjaw and Kiln

The shapes per site stay as in `src/data/fortress.ts`. Gate doors are shut and part of the gatehouse collider.

### Art pass from the references
The existing piece scripts are kept and changed only where a reference says so:
- Masonry color: walls move from dark brown to pale sand stone, between `PAL.wall.top` and `PAL.rock.top`. The sloped base uses the same stone a shade darker (R3, R5, R7).
- Masonry tower: a square block becomes a round drum with a crenellated top and slit windows. The drum is 6 m across, the same footprint, and projects past the curtain face (R3, R4).
- Masonry gatehouse: the opening gets a pointed arch about half the gate's height. The flanking towers stand 1 m proud of the gate face, and a corbel band runs under the parapet over the gate (R4, R5). The footprint stays inside `FORTRESS.gate`, extended by that 1 m on the outer side.
- Scrap wall: the lower 4 m becomes two tiers of mesh basket cells. Rust plate rises above to 12 m, with a wire coil along the top (R6).
- Scrap tower: a sandbag base course and a net-draped top are added (R6).
- Star layout: the re-entrant corners lose their towers (R1).
- Ship metal: no change, unless the screenshots show the walls clashing with `ship_nose` (UK4).

Use the `blender-image-to-3d` skill for this pass, because the pieces are reshaped to the reference photos:
- Phase 0 writes one brief per style in `tmp/fort-art/<style>/asset-brief.md`, with the proportions listed below, the views per photo, and what is inferred.
- Phase 1 builds a calibrated master with a 3.6 m truck proxy and the photos as reference planes.
- Phases 2-3 run review renders and compare sheets: `review_render.py --engine cycles` and `compose_review.py`. Each sheet is judged by eye. Each mismatch is written as a measurement, and the IoU number is a diagnostic only.
- Phases 4-10 are skipped: no baking, UVs, rig, LOD or skill export. The `tools/blender` scripts still write the committed `.glb` as `docs/art.md` describes.

The proportions to check:
- drum height over drum width is 16/6, or 2.7. R4 measures 2.3, and ROAM's is taller because of the 16 m rule.
- tower over curtain is 1.33 (R3)
- gate arch height over gatehouse height is about 0.5 (R5)
- basket tier is about 1.4 m (R6)

### Interim interiors
Until F1-F3, each fortress site keeps today's procedural interior, fitted inside its curtain:
- `buildSettlement` skips any house whose footprint is not inside the curtain, inset by half a wall depth.
- The 6-tile interiors move their pieces inward until they fit. That covers Dustwell palms, camp tanks and hull, the South Lock channel, Salvage Yard stacks, Granary sheds and the Pump Station ruin.
- `buildSite` skips the old circle edge for fortress sites.
- Edge styles that no site uses any more are removed. `fence`, `stone`, `wrecks` and whatever the abandoned sites use stay.

A render test owns this rule, and F1-F3 inherit it.

### Save compatibility
The pieces are baked, so saves never hold them, and the new map file needs no bump. The new `PROP_KINDS` widen `LandmarkLook`, which is reachable from `World`. So one minor `MIGRATIONS` step removes the saved `site-<id>` obstacles of the ten fortress sites and every `bld-bowl-*` and `bld-nose-*`. The step holds its own copy of those ids. No major bump.

### Execution rules
These answer the timeout:
- Phases run one at a time in the foreground, each ending in a commit.
- No agent waits on a background agent.
- Each Blender build is its own foreground command with a timeout of at most 300 s.
- The uncommitted work above is reviewed and committed in PH1 and PH2. It is never reset, regenerated from scratch or discarded.

### Approaches considered
- Chosen: walls first, then the F1-F3 interior tasks. Each slice is mergeable, and the shared system ships once, with one map rebake and one save step.
- One task as before, with only the execution fixed: one stall still loses the whole change, and the committee asked for a smaller deliverable.
- One task per site, each with walls and interior: this repeats the shared layout, bake and save work, adds up to ten map rebakes and ten migration steps, and leaves mixed old and new edges on the map in between.
- A single Blender model per fortress: it cannot follow the road-defined gates, and a ring over 100 m gives a coarse box collider.

TDD: yes for the layout, spawn exclusion, wall stretch, save step and interior fit, which are deterministic rules. No for the model art, which is checked by preview renders, compare sheets and in-game screenshots.

### Invariants
- IV1 — Every fortress piece's posed boxes lie inside its site's circle, and every gatehouse's outer face lies on the circle at a `siteGates()` point.
- IV2 — No fortress site has a `kind:'site'` obstacle. Trucks collide with fortress pieces only through their prop-shape boxes.
- IV3 — Each curtain is closed. No point inside a curtain can reach a pad on the nav grid.
- IV4 — Every wall, gatehouse, tower and bastion model stands at least 3x the tallest truck's model height.
- IV5 — `isFree()` is false everywhere inside a fortress site's circle.
- IV6 — Every pad of every site is still usable. A truck parked on it gets `canUseSite`, and nothing blocks it.
- IV7 — The seven abandoned sites keep their circle obstacle, edge style and interior.
- IV8 — Every interior mesh of a fortress site lies inside its curtain, inset by half a wall depth.
- IV9 — An old save loads with no fortress `site-*` and no `bld-bowl-*` or `bld-nose-*` obstacle.
- IV10 — Each fortress site is still discovered when the player parks on its pad.

### Principles
- PC1 — Fortress layout has one owner, `src/mapgen/fortress.ts`, which reads shape, turn and style from `src/data/fortress.ts`. Render and tests call `fortressOutline()` and never re-derive wall positions.
- PC2 — Every look change in the art pass names the reference feature it comes from. A change no reference supports is out of this task.

### Assumptions
- AS1 — A gatehouse on the circle with a barbican back to the curtain reads as a believable fortress gate from the iso camera.
- AS2 — Dustwell and Green Pit keep their names and the oasis service. Only their look changes, in F2.
- AS3 — The raider camps count as inhabited and become scrap fortresses, with their gate guns and services unchanged.
- AS4 — 12 m walls and 16 m towers meet "3x any truck", since the tallest truck is about 3.6 m.
- AS5 — About 400 extra baked props stay within the `npm run perf` budgets.
- AS6 — Today's interiors, fitted inside the curtains, are an acceptable look until F1-F3 land.

### Unknowns
- UK1 — Whether the vision rule still marks a walled site visible from its pad (IV10).
- UK2 — Whether trucks get stuck in the wedges between a barbican neck and the curtain. `npm run stuck` decides.
- UK3 — Whether the round drum and the arched gatehouse fit in the prop-shape box cap.
- UK4 — Whether the ship-metal pieces read as the same ship as `ship_nose` in-game.

## Plan

Approach: adopt and finish the uncommitted layout and piece work, reshape the pieces against the references, then bake the pieces in as colliders and fit today's interiors inside the curtains. Close with the screenshot comparison. Each phase is small, runs in the foreground and commits on its own. The execution rules in Design apply to every phase.

### PH1 — Adopt the fortress layout (TDD)
- 1.1 Review `src/data/fortress.ts`, `src/mapgen/fortress.ts` and `src/mapgen/fortress.test.ts` as found. Run `npx vitest run src/mapgen/fortress.test.ts`, where 74 tests pass today.
- 1.2 `src/mapgen/fortress.ts:88-99` (modify), `outlineCorners()`: star re-entrant corners get `piece: null` in place of `'tower'` (R1). First update the test at `src/mapgen/fortress.test.ts:130`, so a star has bastions at its points and no towers at its re-entrant corners. Recheck that the closure and no-way-out tests still pass for Bowl and South Lock (IV3).
- 1.3 `src/data/region.ts:5-15` (modify): `SiteEdge` adds `'fortress'`, and the ten fortress sites set it (PC1).
- 1.4 `src/mapgen/fortress.test.ts`: confirm it covers IV1 (pieces inside the circle, gatehouses on gate points), IV3 (closed outline) and the stretch bounds, and add any of them that is missing.
- Commit: `Fortress layout from site data and road gates`

### PH2 — Piece models from the references
- 2.1 Use the `blender-image-to-3d` skill, phases 0-3 only. Read its `SKILL.md` and the Architecture part of `references/categories.md`.
  - For each style, write `tmp/fort-art/<style>/asset-brief.md` with the proportions in Design and the R1-R7 views, then build the calibrated master with `init_master.py`, using `--height 16` and the photos from `tmp/refs/`.
  - Use the masonry style to prove the scale and palette. The scrap style then follows the same rules.
- 2.2 `tools/blender/fort_kit.py` (modify):
  - Masonry palette moves to pale sand stone, and the sloped base takes the same stone, darker.
  - The masonry tower builder becomes a round drum with a crenellated top and slit windows.
  - The masonry gatehouse gets a pointed-arch opening at 0.5 of its height, flanking towers 1 m proud of the gate face, and a corbel band under the gate parapet.
  - The scrap wall gets two 1.4 m basket tiers with mesh, plate above to 12 m, and a wire coil on top.
  - The scrap tower gets a sandbag base and a net-draped top.
  - Heights stay as in `fort_kit.py:40-51` (AS4), and every change names its reference (PC2).
- 2.3 Rebuild each changed `.glb` with its `tools/blender/fort_<style>_<piece>.py`, one foreground command per model with `timeout 300`.
- 2.4 Render with `review_render.py --engine cycles --ref-cam <az> <el> <lens>` matched to R3, R4, R5 and R6, then run `compose_review.py --measure`.
  - Save the sheets in `tmp/fort-art/<style>/review/` and look at each one.
  - Write the remaining mismatches as measurements in `## Verify`. IoU is not a gate.
- 2.5 `scripts/prop-shapes.mjs` keeps the 15 `PROP_MODELS` entries found in the working tree. Run `npm run models:shapes` and commit `src/data/prop-shapes.json`. If the drum or the gatehouse needs more than `maxBoxes`, add a per-model cap for those models only (UK3).
- 2.6 `src/three/render/models.ts:12` (modify): add the 15 names to `NAMES`.
- 2.7 `src/data/prop-shapes.test.ts` (modify): add the IV4 test. The top of each fort model's boxes is at least 3x the tallest truck height from `truck-shapes.json`.
- Commit: `Fortress piece models shaped from fortification references`

### PH3 — Bake, collide and migrate (TDD)
- 3.1 `src/sim/terrain.ts:117` (modify): append `fortWall`, `fortTower`, `fortGate`, `fortBastion` and `fortInner` to `PROP_KINDS`.
- 3.2 `src/mapgen/fortress.ts` (modify): add `fortressLayer(seed: number, d: MapDraft): MapDraft`.
  - It pushes each site's pieces as `BakedProp`s, with group set to the site's index in `[...towns, ...locations]` and step to the piece index.
  - `src/mapgen/bake.ts:26` (modify) runs it last, after `rockLayer`.
  - Run `npm run map:bake` and check that the diff adds only `fort*` props (RK5). Commit `public/maps/icarus.bin`.
- 3.3 `src/sim/mapgen.ts` (modify):
  - `LANDMARK_MODELS` (`:152`) becomes `landmarkModel(o: Landmark): PropModel`. It resolves `fort*` looks to `fort_<style>_<piece>` from the group's site and `FORTRESS_SITES`.
  - `landmarkPose()` (`:193`) stretches `fortWall` along x by `2r / FORTRESS.wallLength` and keeps y and z at 1.
  - `BAKED_ID` (`:44`) accepts `<fortKind>-<group>-<step>`, and `propObstacle()` (`:37`) emits that id for fort kinds.
  - `placeSites()` (`:50-71`) skips `site-<id>` for fortress sites and skips the `bld-<town>-*` loop for Bowl and Nose (IV2, IV7).
- 3.4 `src/sim/sites.ts` (modify): add `isFortress(site: Site): boolean`, true for ids in `FORTRESS_SITES`. `src/sim/spawn.ts:226` `isFree()` returns false when `siteUnder(pos)` is a fortress (IV5).
- 3.5 `src/three/save-migrations.ts:176-224` (modify): append a step that drops the ten fortress `site-<id>` obstacles and every `bld-bowl-*` and `bld-nose-*`. The step holds its own id list.
  - Add a test in `src/three/save-migrations.test.ts` on the latest fixture in `src/three/save-fixtures/` (IV9).
  - Run `npm run save:shape`, and add the new fixture as the existing steps do.
- 3.6 Tests, written first:
  - `src/sim/mapgen.test.ts`: fortress sites have no site obstacle, and abandoned sites keep theirs (IV2, IV7). A stretched wall's posed boxes span its length.
  - `src/sim/spawn.test.ts`: `isFree` is false at the center and just inside the curtain of each fortress (IV5).
  - `src/sim/sites.test.ts` or `src/phys/path.test.ts`: a route from outside reaches every pad of every site (IV6), and no route from a pad reaches a point inside a curtain (IV3).
  - `src/sim/exploration.test.ts`: parking on each fortress pad discovers the site (IV10, UK1). If it fails, `seesArea` (`src/sim/locations.ts:65`) widens discovery to tiles within `radius + pad length`, and this is recorded as a deviation.
  - Update the tests that assume the site circle, such as `src/phys/path.test.ts:50-56` and `src/phys/ai.test.ts:85`.
- Commit: `Fortress pieces bake into the map and replace the site circle collider`

### PH4 — Interim interiors inside the curtain (TDD)
- 4.1 `src/three/render/sites.test.ts` (modify), written first:
  - For each fortress site, every mesh from `buildSites()` lies inside `fortressOutline(site)`, inset by `FORTRESS.wallDepth / 2` (IV8).
  - Abandoned sites keep their edge pieces (IV7).
  - Replace the town-wall and door tests that assume the old edge.
- 4.2 `src/three/render/sites.ts` (modify):
  - `buildSite` (`:464-495`) skips `addWall` for sites where `isFortress` is true.
  - `buildSettlement` (`:169`) skips houses outside the inset curtain.
  - `buildOasis`, `buildCamp`, `buildLock`, `buildWrecks` (the salvage branch), `buildGranary` and `buildPump` (`:366-462`) move their offsets inward until 4.1 passes, keeping each layout's arrangement.
  - Remove the edge styles, `addGuardTower`, `addBanner` and `SET` numbers in `src/data/region.ts` that no site uses any more. Typecheck and lint name them.
- Commit: `Today's site interiors fit inside the fortress curtains`

### PH5 — Docs
- 5.1 `docs/wiki/mechanics/world.md:11`: inhabited sites are fortresses with high walls, towers and shut gates. Their walls block driving and sight by their real shape. Abandoned sites keep their old edges. Run `npm run wiki` if the wiki is generated from it.
- 5.2 `docs/architecture/map.md`: the fortress bake layer. `docs/art.md`: the fort kit, its three styles and the stretched wall rule. `docs/VISUAL_DESIGN.md:8-18`: inhabited sites are walled, and the raider camps have a scrap and basket wall in place of the palisade.
- Commit: `Docs for fortress sites`

### PH6 — Whole-game checks and visual acceptance
- 6.1 Run `npm test`, `npm run typecheck`, `npm run quality` from the root, `npm run playtest -- --cpu`, `npm run stuck` (UK2) and `npm run perf` (AS5).
- 6.2 `tmp/fort-shots.ts`, a Playwright script on the real GPU as `docs/tools.md` describes:
  - For each fortress site, it parks the player on a pad through `__ROAM__` `apply()`.
  - It takes `tmp/shots/<site>-iso.png` from the default camera, plus a close view of one gatehouse as `<site>-gate.png`.
- 6.3 `tmp/fort-compare.py` (Pillow) puts each screenshot next to its reference in `tmp/shots/compare-<site>.png`. Look at each sheet, and record each feature as present or missing in `## Verify`:

  | Site(s) | Reference | Features that must match |
  | --- | --- | --- |
  | Bowl iso | R2 | pointed star outline readable from the camera; bastion points; straight curtain between points; houses inside |
  | South Lock iso | R1 | arrowhead bastions; no towers at the re-entrant corners; gate in the curtain between bastions |
  | Granary, Green Pit and Scrapjaw iso | R3 | closed ring; towers at even spacing that rise above the wall walk and project past its face; crenellations; pale stone (Granary, Green Pit) |
  | Dustwell and Pump Station iso | R4 | square plan; round corner towers; slit windows; crenellated curtain |
  | Any masonry gate close-up | R5 | pointed arch about half the gate height; flanking towers proud of the gate face; corbel band; shut doors |
  | Kiln and Salvage Yard gate close-up | R6 | two basket tiers at the base; rust plate above; wire coil on top |
  | Nose iso | `ship_nose` in the same shot | wall plating and color read as the same ship metal (UK4) |
  | All | — | each wall stands over 3x the player truck in the same shot (IV4); interiors stay inside (IV8) |

- 6.4 Any missing feature goes back to PH2 or PH4 as a fix. Leave the sheets in `tmp/shots/` for the user, who confirms the look. The task ends at `validating` until they do.
- Commit: none, unless 6.4 changes code.

### Test strategy
- PH1, PH3 and PH4 follow TDD with the tests named in 1.2, 1.4, 3.6 and 4.1. They cover IV1-IV3 and IV5-IV10.
- PH2 has the IV4 height test, plus compare sheets judged by eye.
- PH6 covers the side effects: `stuck` for pad parking and wedges, `perf` for the extra props, the save fixtures, and the screenshot sheets against R1-R7.

### Order & dependencies
- PH1 and PH2 own separate files and can run back to back in any order.
- PH3 needs both: the bake needs the layout, and the poses need the shapes.
- PH4 needs PH3's `isFortress`. PH5 follows PH4, and PH6 comes last.

### Risks / rollback
- RK1 — A gate lies near an outline corner. `fortressPieces` throws, and the 1.4 test catches it. Tune that site's `turn` in `src/data/fortress.ts`.
- RK2 — Trucks get stuck in a barbican wedge (UK2). Add `FORTRESS.minWedge`, close narrow wedges with a wall piece, and rerun `npm run stuck`.
- RK3 — Sight checks slow down with about 400 more props (AS5). If `npm run perf` misses, bucket the sight props the way `src/sim/nav/buckets.ts` does, and record it as a deviation.
- RK4 — The 12 m walls hide interiors at low zoom. The screenshots decide. Shorter walls would break IV4, so raise this with the committee instead of shrinking them.
- RK5 — The map rebake shifts other baked props. The fortress layer runs last and only adds props, so 3.2 checks that the diff is `fort*` only.
- RK6 — A long Blender or Playwright run stalls a phase, the cause of the first failure. Run each command in the foreground with a timeout. Never wait on a background agent, and commit at each phase end.
- Rollback: each phase is its own commit. Reverting PH3 restores the circle colliders and the old map.

### Interfaces
- IF1 [blocks] — `fortressPieces(site: Site): FortressPiece[]` and `fortressOutline(site: Site): Vec[]` in `src/mapgen/fortress.ts`. PH3 bakes their real output, and PH4's test reads the outline.
- IF2 [blocks] — the `prop-shapes.json` entries and `.glb` files for `fort_<style>_<piece>`. PH3's poses and the bake need the generated shapes.
- IF3 [blocks] — `isFortress(site: Site): boolean` in `src/sim/sites.ts`, and the rebaked map. PH4 needs both, because its render test builds the sites from the new map.

### Interface graph
- PH1 -> IF1 @ src/data/fortress.ts, src/mapgen/fortress.test.ts, src/data/region.ts
- PH2 -> IF2 @ tools/blender/fort_*.py, public/models/fort_*.glb, scripts/prop-shapes.mjs, src/data/prop-shapes.json, src/data/prop-shapes.test.ts, src/three/render/models.ts
- PH3 IF1, IF2 -> IF3 @ src/sim/terrain.ts, src/mapgen/bake.ts, src/mapgen/fortress.ts, src/sim/mapgen.ts, src/sim/spawn.ts, src/sim/sites.ts, src/three/save-migrations.ts, src/three/save-fixtures/, public/maps/icarus.bin, src/sim/*.test.ts, src/phys/*.test.ts
- PH4 IF1, IF3 -> @ src/three/render/sites.ts, src/three/render/sites.test.ts
- PH5 -> @ docs/
- PH6 -> @ tmp/

## Verify
- Screenshots in `tmp/shots/<site>-iso.png` and `-gate.png` (software render, no GPU here; no reference side-by-side sheet was made). Bowl, South Lock, Kiln, Nose, Dustwell, Granary and Salvage Yard were shot.
- Seen: star outline with pointed bastions and crenellated curtain (Bowl, South Lock); round drum towers with banding on a ship-metal curtain (Nose); square plan with corner towers (Kiln, scrap); walls tower over the player truck at the gate. Houses stay inside the curtain (Bowl, Nose).
- Not checked by eye: R5 pointed-arch gate detail and R6 basket tiers at close range; the user confirms the look.
- Not run here: `npm run playtest`, `stuck`, `perf` (instructed to leave them to the later stages).
- `npm test` passes when its slow files run alone; under full parallel load several heavy tests hit their timeouts on this machine.

## Code smells

## Conclusion
- PH3 and PH4 landed in one commit ("Fortress pieces bake into the map...") because the interior fit and the new collisions had to pass together.
- Deviation (UK1): `discoverSites` looks `pad.length` tiles past the radius for fortress sites, since the walls hide the inside.
- `touchesObstacle()` in `src/sim/mapgen.ts` judges props by their boxes. `isFree` and the player-start check use it, as a gatehouse's reach circle covered its own pad.
- Removed dead code: the town building ring, `roadExits`, and their `REGION.sites` numbers. Seed-1 greedy econ test moved to seed 2, since the removed random draws shifted seed 1's luck.
- Interiors are pulled toward the center per piece (`pullInside`), South Lock's channel is shorter. Unfixed: pulled pieces may overlap each other.
### Hands-off decisions
- udesign: re-scoped to the fortress curtains, with interiors and animation moved to follow-ups F1-F3 — the committee asked for a manageable deliverable, and the curtains are the shared system every interior builds on.
- udesign: the uncommitted layout and piece work is adopted and changed in place, never regenerated — the committee asked to keep it, and its 74 layout tests pass.
- udesign: seven Wikimedia Commons photos (R1-R7), downloaded to git-ignored `tmp/refs/` and inspected — the committee authorized the lookup and forbade committing third-party pictures.
- udesign: star forts lose their re-entrant towers, masonry towers become round drums, and masonry turns pale — R1, R3, R4 and R7 show these features.
- udesign: towers stay at 16 m, not Bodiam's 2x curtain — R3's ratio fits, and taller towers would hide more of the interior (RK4).
- udesign: `bld-bowl-*` and `bld-nose-*` are dropped in this task, while the oasis ponds stay — the buildings cross the star curtain, and the ponds fit inside it.
- udesign: today's interiors stay as interim scenery fitted inside the curtains (AS6) — the walls can ship without breaking the look of the sites.
- udesign: the site circle stays the gate ring, and gates and pads stay put — most reversible, and it leaves every pad consumer alone.
- udesign: raider camps are inhabited (AS3), and oases keep their kind and names (AS2).
- udesign: one minor save step, no major bump.
- uplan: execution runs phases in the foreground with per-command timeouts and no background waits — this answers the 600 s stall.
- uplan: plan auto-approved.

### Testing stage
- Merge of base (issues 111, 114, 128) resolved. Fortress save step is now 9 to 10 with fixture `format-2-9.json`; `format-2-7.json` is the base's. Territories (Fallen Sun, Orchard, Broken Wing) are excluded from site circles and fortress tests; `touchesObstacle` now uses `blockingBoxes`. Map rebaked, save shape 2.10 committed in its own commit (the version check needs a non-merge commit).
- Focused tests pass (mapgen, terrain-file, fortress, save-migrations, sites render, spawn, exploration, path, ai); typecheck and quality gate pass. Full suite, playtest, stuck and perf not run here.

### Round 2 (check failure)
- Only `npm run playtest -- --cpu` failed: turn 1 passed the 60 s limit. Tests (3163) and typecheck passed.
- Cause, not from this change: software rendering plays a turn frame by frame at about 1 fps. On origin/main a turn took 92 s here, and on this branch 98 s, with 837k vs 873k triangles per frame.
- Separate commit "Playtest --cpu waits up to 240 s per turn" raises `TURN_LIMIT_MS` for `--cpu` in `scripts/playtest.mjs`. The playtest then passed (4 turns).
- No player-visible change, so the visual comparison and approval stand. The evidence manifest only has its commit updated.

### Visual comparison
Sheet `.factory/comparison.png`: Bowl vs R2 (Palmanova), Nose vs R3 (Carcassonne), software render.
- Matches: pointed star outline with bastions and a straight crenellated curtain, dense houses inside (R2); closed round ring with projecting drum towers at even spacing, pale stone (R3); walls far above the truck at the gates.
- Remaining: the scene is dark (night lighting, no GPU), so stone looks greyer than the photos; Nose's ship-metal wall is darker than the ship hull; R4-R6 gate arches and basket tiers are only partly legible at game zoom. Left for the user's look check.
