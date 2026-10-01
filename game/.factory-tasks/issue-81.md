# Salvage territories: the Fallen Sun first

**Status:** executed
**Branch:** factory/issue-81
**Worktree:** none
**Goal:** In a new game, the player can drive into the Fallen Sun and among its baked ship debris. They can park beside any of its many loot spots and search it. NPC scavengers search those spots too, raiders and vultures hunt there, and a truck near the glowing reactor loses driver health. `npm test`, `npm run stuck`, `npm run playtest` and `npm run perf` pass, and `npm run econ` reports before/after wages.
**Mode:** hands-off

## Context
- Issue 81 asks for three salvage sites to become large territories full of small lootable places, fit for scavenging, hiding and fights. They are Old Orchard, Fallen Sun and Podfield. It also asks to move them into empty map space and keep roads for New World settlements. Triage asked design to cut this into a first slice.
- Today every location is a solid circle that trucks never enter. The `site` obstacle blocks routes and physics over the whole radius (`src/phys/drive.ts:144`, `src/sim/nav/layer.ts:171`). The Fallen Sun is such a circle with a 44-tile radius and a fence (`src/data/region.ts:186`).
- A site's loot is one `SalvageStock` whose id is the site id, searched from a gate pad (`salvageInRange`, `src/sim/salvage.ts:112`). It uses one `landmark` table: about 1–2 scrap, 1–2 parts and a 20% spare part (`src/data/salvage.ts`).
- Road wrecks already work like small loot spots. Each is a stock that shares its obstacle's id, is searched by parking within reach and is rolled at world creation (`initializeSalvage`, `src/sim/salvage.ts:34`).
- The hull, orchard trees and pods are drawn at render time in `src/three/render/sites.ts` and have no collision. Baked props collide by their real model boxes and block sight (`propBoxes`, `src/sim/mapgen.ts:241`).
- The bake flattens and clears every site radius (`src/mapgen/bake.ts:98`, `clearOfSites` in `src/sim/mapgen.ts:139`). The Fallen Sun lies in its own 50-tile crater (`src/data/terrain.ts:116`), reached by two dead-end approach roads (`src/data/region.ts:329`).
- Scavengers, roamers and vultures list only `burnt-convoy`, `podfield` and `ridge-wrecks` as salvage sites (`src/data/npcs.ts:1095`). Nobody but the player loots the Fallen Sun. `huntingGrounds` sends raiders and vultures to loot-site pads (`src/sim/npc-decisions.ts:295`).
- Nothing deals damage by area today. Starving lowers driver `health` by `starveDamage` 5 per turn down to `starveFloor` 30, so only cab damage kills (`src/data/rules.ts:128`, `src/sim/resources.ts:33`).
- Saves record the map hash. A save from another map carries over through the rescue screen, and a new map file needs no format bump (`docs/architecture/saves.md`).

## Design

### Scope
This task builds the shared territory machinery and turns the Fallen Sun into the first territory, where it already stands. The Fallen Sun goes first because it already sits off the road network in its own crater, so no road or town moves. It is also the request's main example.

Follow-up tasks, not planned here, each reuse this machinery:
- **Old Orchard territory.** A military-held farm complex with breakable dead trees and military props, moved into the open west-centre (region x 30–50, y 58–84). Its road spur is removed.
- **Podfield territory.** A field of life pods and pod-rack sections with a landform feature, moved into open ground. Its road spur is removed.
- **Roads for the New World.** Decide what happens to the road-side wreck sites, Burnt Convoy and Ridge Wrecks, so roads serve only settlements.
- **Art passes.** Bespoke Blender models for each territory, such as hull sections a truck can drive onto.

### Territory
- A territory is a new location kind, `territory`, in `REGION.locations`. It keeps an id, a name, a centre and a radius, so discovery and map labels work unchanged.
- A territory has no edge, no gates, no pads and no `site` obstacle. Trucks drive into it freely.
- Its own baked props block driving and sight by shape, like any baked prop. That gives cover, hiding places and ambush lines.
- Rules for each territory live in data, in a new `TERRITORIES` table. That table holds debris counts and kinds, loot spot counts per ring, the loot tables and the hazard.

### Loot spots
- A **loot spot** is a baked prop of a lootable kind inside a territory.
- At world creation each spot gets a `SalvageStock` with the spot's obstacle id and reach, the same path road wrecks use. A player or NPC parks beside a spot and searches it with the existing search job.
- Loot is graded by ring:
  - **Inner spots** lie near the hazard and roll the old `landmark` table, which was the site's whole stock.
  - **Outer spots** roll a scrap-heavy table at road-wreck size.
  - The richest loot therefore sits where the reactor hurts, a risk the player chooses.
- A territory stock has no site stock behind it, and `isSiteStock` stays false for spots.

### Renewal
- Spots never move or disappear. Each day each spot regains `restockShare` of a fresh roll, up to its table's highs, by the rule sites use today.
- An emptied spot fills back over about two weeks. Because the territory is large, some part of it always holds something, which answers the issue's "why is it not picked clean".
- Restock gets one owner for sites and spots, with no second rule.

### Bake
- A new mapgen layer places territory props after the old-world layer. It places:
  - large blocking debris for cover
  - loot spots, spread with a minimum gap
  - the reactor prop at the hazard centre
- Territory ground is not flattened, so the crater's banks and slopes stay. Other layers keep clearing territory ground, so only territory props stand there.
- New prop kinds go last in `PROP_KINDS`. The first slice reuses existing models where they fit (`ship_hull` and `ship_nose` scaled down, `wreck`, `tank_hulk`, `crates`, `fuel_tank`). A kind with no fitting model gets a Blender model through `docs/art.md`.
- The render-time hull, fence and gates of the Fallen Sun are removed. The bake is re-run and the map file committed.

### Reactor hazard
- Each territory may declare a hazard: a centre, a radius, and driver health lost per turn inside it.
- One sim owner applies it to every truck each turn, player and NPC alike. The health loss stops at a floor, so the reactor never kills by itself, the same as starving.
- The log tells the player once each time their truck enters the zone, in character, and shows no numbers.
- The reactor prop glows in the render, so the danger is seen before it is felt.
- NPC route planning treats hazard tiles as blocked, so NPC routes and goals never end inside the zone. The player may drive in by hand.

### NPCs
- `fallen-sun` joins the `salvageSites` of scavengers, roamers and vultures.
- An NPC scavenge goal at a territory picks one non-empty loot spot of that territory as its target, drives to it and searches it. NPCs know fixed places, so spot positions count as known. Contents are judged with the same check used for sites today.
- `huntingGrounds` adds points inside each territory, so raiders and vultures patrol where scavengers work.
- Travel goals to a territory end at a point on its edge, not at a pad.
- Fights then come from existing rules: scavengers sometimes rob, raiders hunt, and vultures loot whoever is downed.

### Approaches considered
- **A, chosen: spots are baked props with their own stock, like road wrecks.** This reuses search, reach, NPC loot and save shape without a new type. Spot ids depend on the bake, but that is already true of road wrecks, and a new map moves saves through rescue anyway.
- **B: keep one site stock and spread its search points.** This changes less, but it makes no real places to prowl between and keeps the walled-site model the issue rejects.
- **C: hand-placed spot lists in `src/data/region.ts`.** This gives full art control, but it costs a lot of hand work for every territory and fights the bake's terrain and prop clearing. The follow-up art passes can still pin special props by data.

### Backwards compatibility
- `SalvageStock`, `World` and `types.ts` keep their shape, so there is no save format change.
- The map file changes, so old saves load through the rescue screen. They carry progression, the truck and discovered places, as for every map change.
- The `fallen-sun` stock id goes away. Rescue drops it from `player.scavenged`.
- `fallen-sun` stays a location id, so discovery carries over.

TDD: yes. Spot stock creation, restock, the hazard rule, NPC spot targeting and the absence of pads for territories are deterministic sim rules with Vitest coverage.

### Invariants
- IV1 — A territory has no gates, pads or `site` obstacle. `siteGates`, `sitePads` and `canUseSite` never treat it as a pad site, and no code path throws for it.
- IV2 — Every lootable prop inside a territory has exactly one `SalvageStock` with the same id at world creation. No territory stock exists without its prop.
- IV3 — Every loot spot is reachable by NPC routing from the end of an approach road, and none lies inside a hazard zone. A test asserts this on the baked map.
- IV4 — Hazard damage changes only driver `health`, never drops it below the hazard floor and applies to player and NPC trucks by the same rule.
- IV5 — No NPC goal destination lies inside a hazard zone.
- IV6 — All new numbers live in `src/data/` (`TERRITORIES`, salvage tables). Sim and mapgen read them from there.
- IV7 — Bake randomness stays in the bake's seeded stream, and world-creation stock rolls go through `src/sim/rng.ts`.
- IV8 — The map stays deterministic: a re-bake from the same seed gives the same file hash.

### Principles
- PC1 — Reuse the road-wreck stock path for spots. Do not add a second search or reach rule.
- PC2 — Territory is data-driven: a follow-up territory adds a `TERRITORIES` entry, prop kinds and art, with no new sim code.
- PC3 — Keep the first slice to existing models where they read well. A bespoke model belongs in the art passes unless no existing model fits a role.

### Assumptions
- AS1 — Debris props built from existing models read as a broken ship from the isometric camera. Screenshots confirm this, and the user checks the look.
- AS2 — The crater banks inside the Fallen Sun's 44-tile radius are drivable once the site circle is gone. Routes and the stuck soak confirm this.
- AS3 — "Drive onto ship parts" is out of this slice. Low plates below `truckClearance` can be crossed, but raised drivable decks need ramp colliders or terrain work, which belongs to the Fallen Sun art pass.
- AS4 — The reactor's "health damage" means driver health, as the issue says, not part HP.
- AS5 — Hazard numbers start at the starving rule's 5 per turn with a floor of 30. That rule is the one existing non-combat health drain, so it is the anchor. The committee can retune it.
- AS6 — The first spot counts are 6 inner and 18 outer, with debris at about twice the spot count. They are a starting point for `npm run econ` and playtest, not a balanced result.

### Unknowns
- UK1 — How much more loot the map holds, and what that does to the tier 1 wage. Run `npm run econ` before and after, and report both in the conclusion.
- UK2 — The frame cost of the extra baked props against `scripts/perf-budgets.json`.
- UK3 — Whether NPC scavengers stall or crowd among the debris. `npm run stuck` decides, along with the spot gap.
- UK4 — Whether NPC knowledge of spot contents should be by sight only. The plan checks how site contents are judged today and matches it.

## Plan

Approach: a territory is a location of kind `territory` with no edge, gates, pads or site obstacle. It is filled at bake time with debris and loot-spot props of new prop kinds. Each loot spot gets a road-wreck-style `SalvageStock` with the obstacle's id (PC1). One new sim owner, `src/sim/territory.ts`, answers every territory question: membership, spots, ring tables, entries and hazard zones. Sites, salvage, NPCs, nav and render ask it instead of deciding on their own. The phases run in data, bake, stock, hazard, NPC, render and docs order. A baseline `npm run econ` is captured first, so UK1 has a before number.

### PH0 — Baseline
- 0.1 Run `npm run econ` and `npm run perf` on the untouched branch. Keep both outputs under `tmp/issue-81/` (untracked) for the PH7 comparison. Respects: UK1, UK2.
- Commit: none.

### PH1 — Territory data and owner
- 1.1 `src/data/region.ts:6-14` (modify)
  - Add `"territory"` to `LocationDef.kind`.
  - Make `edge` optional only for territories, through a separate `TerritoryDef` member of the union, so other kinds keep a required edge.
- 1.2 `src/data/region.ts:184-191` (modify)
  - `fallen-sun` becomes `kind: "territory"` with no edge, keeping its id, name, pos and radius.
  - The two approach roads (`:329-345`) stay as dead-end tracks to the rim.
- 1.3 `src/data/territory.ts` (create)
  - `TERRITORIES: Record<string, TerritoryRules>`. Each entry holds:
    - `debris`: kinds, a count and a radius range for each
    - `spots`: lootable kind, then count, ring band (inner or outer share of radius), radius range and loot table
    - `spotGap`
    - `hazard`: `{ radius, healthPerTurn, floor }` or null
  - The Fallen Sun entry:
    - inner spots: 6, on the `SALVAGE.landmark` table
    - outer spots: 18, on a new `SALVAGE.hullScrap` table the size of a road wreck
    - debris: about 2 × the spot count
    - hazard: `healthPerTurn` 5 and floor 30, each with a comment naming the starving rule as its anchor
  - Respects: IV6, AS5, AS6.
- 1.4 `src/data/salvage.ts:43-73` (modify)
  - Add `hullScrap: LootTable`, with scrap [1,2], parts [0,1], spare 0.1 from ship-flavoured spares, fuel [0,4] and supplies [0,1].
- 1.5 `src/sim/territory.ts` (create). Pure queries over `REGION` and `TERRITORIES`, with no world writes (GPC3):
  - `isTerritory(site: Site): site is TerritoryDef`
  - `territoryAt(pos: Vec): TerritoryDef | null`
  - `isLootSpot(o: Obstacle): boolean`, true for a landmark whose `look` is a spot kind of the territory holding it
  - `spotTable(o: Obstacle): LootTable`, which throws for a non-spot
  - `territorySpots(world: World, id: string): SalvageStock[]`
  - `territoryOfStock(world: World, stockId: string): TerritoryDef | null`
  - `territoryEntries(t: TerritoryDef): Vec[]`, the points where roads meet the territory edge, from the same crossing math as `siteGates`
  - `hazardZones(): { pos: Vec; radius: number; healthPerTurn: number; floor: number }[]`
- 1.6 `src/sim/sites.ts:16-60` (modify)
  - `siteGates` and `sitePads` return `[]` for a territory, so its missing gate never throws.
  - `canUseSite` is false for a territory.
  - Expose `edgeCrossings` for `territoryEntries`, so the crossing math is not duplicated (GPC8).
  - Respects: IV1.
- 1.7 `src/sim/mapgen.ts:51-54` `placeSites` (modify): emit no `site-<id>` obstacle for a territory. Respects: IV1.
- 1.8 `src/sim/mapgen.ts:133-135` `clearOfSites`: unchanged. Other layers still keep out of territory ground. Territory props are placed by their own layer, which skips this check for its own territory.
- 1.9 `src/sim/elevation.ts:66-80` `flattenFactor` and `src/mapgen/bake.ts:165-176` `builtType`: skip territories, so the crater relief and natural ground stay.
- 1.10 `src/sim/salvage.ts:44-48` `siteLootTable`: returns null for a territory, so it gets no site stock.
- 1.11 Tests in `src/sim/territory.test.ts` and `src/sim/sites.test.ts:21`:
  - The large-location list now holds only `orchard`.
  - A territory has no gates, pads or site obstacle, and `canUseSite` is false on its rim.
  - `territoryAt` works inside and outside.
- Commit: `Territory kind: the Fallen Sun loses its edge, gates and pads`

### PH2 — Bake: territory layer and prop kinds
- 2.1 `src/sim/terrain.ts:117` `PROP_KINDS` (modify): append, keeping order:
  - `hullChunk` and `hullNose` for blocking debris
  - `shipCache` for an outer spot
  - `coreWreck` for an inner spot
  - `reactor` for the hazard centre
- 2.2 `src/sim/mapgen.ts:149-166` `PropModel` / `LANDMARK_MODELS` / `MODEL_RADIUS` (modify)
  - Model mapping: `hullChunk`→`ship_hull`, `hullNose`→`ship_nose`, `shipCache`→`crates` or `wreck`, `coreWreck`→`tank_hulk`-sized `ship_nose`.
  - `reactor` gets a new Blender model only if no model reads as a reactor core (`tools/blender/reactor.py`, by `docs/art.md`).
  - Run `npm run models:shapes` so `prop-shapes.json` holds every new model.
  - Respects: PC3, AS1.
- 2.3 `src/mapgen/territory.ts` (create): `territoryLayer(seed: number, d: MapDraft): MapDraft`. For each `TERRITORIES` entry it places, in order:
  - the reactor at the centre
  - inner spots, then outer spots, then debris
  - Each prop draws a ring position from `ruleRng(seed, offset)`. It must keep `spotGap` from other props, stay off cliff tiles and stay outside the hazard radius plus a margin (IV3).
  - Spots go before debris, so debris never boxes a spot in.
  - Placement reuses `prop()` and `tilesWithin` from `src/mapgen/oldworld.ts:98-160`.
  - Respects: IV7, IV8.
- 2.4 `src/mapgen/bake.ts:19-27` `bakeMap` (modify): run `territoryLayer` after `new world` and before `ground`.
- 2.5 Run `npm run map:bake` and commit `public/maps/icarus.bin`.
- 2.6 Tests in `src/mapgen/territory.test.ts`:
  - The bake is deterministic: same seed, same props (IV8).
  - The spot counts match the data.
  - No spot lies inside the hazard.
  - Every spot is reachable by `src/sim/nav` from each `territoryEntries` point on the baked map (IV3, AS2).
  - `src/sim/mapgen.test.ts:101` excludes a territory's own props from the "outside every site" rule.
- Commit: `Bake debris, loot spots and the reactor into the Fallen Sun`

### PH3 — Loot spot stocks and renewal
- 3.1 `src/sim/salvage.ts:34-41` `initializeSalvage` (modify)
  - After the site stocks, roll one stock per `isLootSpot` obstacle with `spotTable(o)`, at `o.pos` and `propReach(o)`.
  - The order is sites, then spots, then road wrecks. Spots are added before road wrecks, so their rolls do not shift existing wreck rolls more than needed.
  - Respects: IV2, PC1.
- 3.2 `src/sim/salvage.ts:338-347` `renewSalvage` (modify): also restock each spot stock with `restockSite(world, stock, spotTable(obstacle))`. Spots never turn over like road wrecks.
- 3.3 `src/sim/salvage.ts:110-114` `salvageInRange`: no change. A spot is not a site, so the stock-reach branch already applies. A test pins this.
- 3.4 Tests in `src/sim/salvage.test.ts`:
  - Each spot has one stock with the same id (IV2).
  - An inner spot rolls within the landmark table's ranges.
  - An emptied spot regains loot over days and never passes the table's highs.
  - The player parked beside a spot can search it, and a moving player cannot.
- Commit: `Loot spots hold their own salvage and restock daily`

### PH4 — Reactor hazard
- 4.1 `src/sim/hazard.ts` (create)
  - `applyHazards(world: World): void` lowers `getResources(world, v).health` by `healthPerTurn`, down to `floor`, for every non-knocked-out vehicle inside a zone. Health already below the floor stays.
  - For the player, it pushes `{ t: 'info', text }` once per entry, when the truck was outside the zone at the start of the turn. The previous position comes from the turn's start pose, so no state is saved.
  - The text is in character, with no numbers.
  - Respects: IV4, AS4.
- 4.2 `src/sim/world.ts:282-283` (modify): call `applyHazards(w)` beside `consumeSupplies(w)`.
- 4.3 `src/sim/nav/layer.ts:168-172` (modify): add each `hazardZones()` circle as a route blocker. Physics gets no collider, so the player can still drive in by hand. Respects: IV5.
- 4.4 Tests in `src/sim/hazard.test.ts`:
  - Health drops inside the zone, stops at the floor and is unchanged outside.
  - An NPC and the player lose the same amount.
  - The log line comes once per entry.
  - Parts HP is untouched.
  - A nav route between two points on opposite sides of the reactor avoids the zone.
- Commit: `The Fallen Sun reactor drains driver health nearby`

### PH5 — NPCs in territories
- 5.1 `src/data/npcs.ts:1095,1174,1182` (modify): add `'fallen-sun'` to scavenger, roamer and vulture `salvageSites`. Line 1162's `travelSites` keeps `fallen-sun`.
- 5.2 `src/sim/npc-decisions.ts:287-289` `salvageSitesAway` and `:387-389` `travelSitesAway`: a territory counts as away when `territoryAt(vehicle.pos)` is not it, instead of the pad check.
- 5.3 `src/sim/npc-activities.ts:276-284` `scavengeGoal` (modify)
  - When the picked site is a territory, target a random spot stock of it from `territorySpots`, drawn with `randInt`, as `createActivity('scavenge', stock.id, stock.pos, …)`.
  - Spot contents are not checked, matching sites, where "a driver learns a stock is empty only once it can reach it" (UK4).
- 5.4 `src/sim/npc-activities.ts:415-419` `scavengeInvalid`: a target whose `territoryOfStock` is known stays valid out of sight, like a site target.
- 5.5 `src/sim/npc-activities.ts:305-309` `travelGoal` and `:1076-1083` `siteStop`
  - Travel to a territory uses a `territoryEntries` point as its destination.
  - `siteStop` returns that destination as is when the target is a territory.
- 5.6 `src/sim/npc-decisions.ts:295-302` `huntingGrounds`: add `territoryEntries` points and the outer-ring spot positions of each territory. Respects: IV5, because no spot lies in a hazard.
- 5.7 Tests in `src/sim/npc-activities.test.ts` and `src/sim/npc-decisions.test.ts`:
  - A scavenger that picks the Fallen Sun targets a spot stock inside it.
  - It keeps the goal while out of sight.
  - It parks beside the spot, searches and takes loot.
  - A vulture's hunting grounds include Fallen Sun points.
  - No goal destination lies in a hazard zone.
- 5.8 Run `npm run stuck`. Fix any stall at its cause, by spot gap or placement, never by a stall exemption. Respects: UK3.
- Commit: `Scavengers, raiders and vultures work the Fallen Sun`

### PH6 — Render and docs
- 6.1 `src/three/render/sites.ts:464-490` `buildSite` / `:497` `buildSites` (modify)
  - Territories build no site group: no hull, no fence, no gates.
  - Remove the `fallen-sun` case and `HULL_RADIUS` if it becomes unused.
  - `src/three/render/sites.test.ts:92-96`: drop the hull size check.
- 6.2 The landmark prop view: the `reactor` look gets an emissive core material and one point light, through the existing prop pose path. Keep stencil bit rules, so `PROP_BIT` is used only by props.
- 6.3 `src/render/groundPaint.ts:40`: no change unless territory ground paint looks wrong in screenshots.
- 6.4 Docs:
  - `docs/wiki/mechanics/world.md`: add a Territories paragraph covering the drivable ground, loot spots, renewal and the reactor.
  - `docs/wiki/mechanics/economy.md`: loot spots.
  - `docs/wiki/mechanics/content.md`: the Fallen Sun line.
  - `docs/architecture/map.md`: the territory layer.
  - `docs/architecture/economy.md`: spot stock in `salvage.ts`.
  - Run `npm run wiki` if the generated tables change.
- 6.5 Drive a Playwright script in `tmp/` into the Fallen Sun on the real GPU. Screenshot the debris, a spot search and the reactor glow, and look at them. Respects: AS1.
- Commit: `Draw the Fallen Sun as open ship debris with a glowing reactor`

### PH7 — Whole-game checks
- 7.1 Run `npm test`, `npm run typecheck`, `npm run quality` (root), `npm run stuck`, `npm run playtest` and `npm run perf`.
- 7.2 Run `npm run econ` and compare against the PH0 baseline. Record both wages in the Conclusion.
  - If the tier 1 wage rises by more than the gap to the tier 2 wage, cut outer spot counts in data and re-run.
  - Otherwise report the numbers for the committee (UK1, AS6).
- Commit: none, unless tuning changes data, which commits as `Tune Fallen Sun loot spot counts`.

### Test strategy
- TDD for PH1, PH3, PH4 and PH5. Each sim rule gets a failing Vitest first, in the test files named in each phase.
- Bake tests on the real baked map (PH2) cover IV3 and IV8.
- Side effects:
  - A road wreck's stock and turnover are unchanged.
  - Other sites keep pads and gates.
  - `npm run save:shape` reports no change, since the shape is unchanged.

### Order & dependencies
- PH0 comes first.
- PH1 blocks every later phase.
- PH2 blocks PH3, PH5 and PH6, since they need the baked spots.
- PH4 needs only PH1.
- PH7 runs last.

### Risks / rollback
- RK1 — Spot rolls in `initializeSalvage` shift world RNG for every later draw, which can move NPC spawns and fixture-pinned tests. Update only the tests that pin incidental draws, and note each one.
- RK2 — Debris boxes trap trucks or NPCs inside the crater. `spotGap`, the reachability test and `npm run stuck` catch it. Widen gaps in data.
- RK3 — The crater banks are too steep to enter. The PH2 reachability test fails first. If it does, ease the crater `bank` in `src/data/terrain.ts:116` and re-bake, and log it as a deviation.
- RK4 — More props cost frame time. `npm run perf` decides. Cut the debris count before adding any render tricks.
- RK5 — Old saves land on the rescue screen because of the new map hash. This is expected for a map change, as `docs/architecture/saves.md` says, and needs no format bump.
- Rollback: each phase is one commit on `factory/issue-81`. Reverting PH2 to PH6 restores the old map file and walled site.

### Interfaces
- IF1 [blocks] — `src/sim/territory.ts` queries (1.5), with the `TERRITORIES` data shape. Every later phase calls them, and the bake and stock phases need their exact semantics.
- IF2 [blocks] — `public/maps/icarus.bin` with the new prop kinds. PH3, PH5 and PH6 tests run on the real baked spots.
- IF3 — `applyHazards(world: World): void` and `hazardZones()`, used by the nav layer and NPC tests.

### Interface graph
- PH1 -> IF1 @ src/data/region.ts, src/data/territory.ts, src/data/salvage.ts, src/sim/territory.ts, src/sim/sites.ts, src/sim/mapgen.ts, src/sim/elevation.ts, src/mapgen/bake.ts
- PH2 IF1 -> IF2 @ src/sim/terrain.ts, src/mapgen/territory.ts, tools/blender/, src/data/prop-shapes.json, public/maps/icarus.bin
- PH3 IF1, IF2 -> @ src/sim/salvage.ts
- PH4 IF1 -> IF3 @ src/sim/hazard.ts, src/sim/world.ts, src/sim/nav/layer.ts
- PH5 IF1, IF2, IF3 -> @ src/data/npcs.ts, src/sim/npc-decisions.ts, src/sim/npc-activities.ts
- PH6 IF2 -> @ src/three/render/, docs/

## Conclusion

### Hands-off decisions
- udesign: first slice is the machinery plus the Fallen Sun only — it needs no relocation or road change, and it is the issue's main example.
- udesign: Old Orchard, Podfield, the road cleanup and the art passes become follow-up tasks — triage asked for a first slice, and each reuses this machinery.
- udesign: spots are baked props with road-wreck style stocks (approach A) — this avoids a save format change and reuses search and NPC loot.
- udesign: hazard anchored on the starving rule (5 per turn, floor 30) — it is the existing non-combat health drain and keeps "death only from injury".
- udesign: hazard blocks NPC routes but not the player — the player chooses risk, and NPCs have no rule for weighing it.
- udesign: inner spots use the old landmark table — the site's own numbers are the rigid anchor for the richest loot.
- uplan: one owner `src/sim/territory.ts` for territory queries — sites, salvage, NPCs and nav ask it, so no second rule appears.
- uplan: the hazard blocks nav routes but adds no physics collider — NPC and auto-travel routes avoid it, and the player can still drive in.
- uplan: the hazard log reuses the `info` event and the turn-start pose — no saved state and no save format change.
- uplan: plan auto-approved

### Deferred (needs user input)
- Spot counts and outer-spot loot size (AS6) — no rule sets them — the committee confirms or retunes after the `npm run econ` report.

### Deviations from plan
- Blender models `hull_chunk` and `hull_rib` replace `ship_hull` and `ship_nose` as debris, and `hullRib` replaces `hullNose` — the shape tool needs closed meshes and the ship models are open. A new `reactor` model was added, since no existing model reads as a core.
- `territoryOfStock` takes a stock, not `(world, id)` — it reads the stock's position and baked id, so NPC picks stay cheap.
- `huntingGrounds` uses a ring through the outer spot band, not spot positions — it is built from the region alone, before any baked map exists. `territoryGrounds` in `src/sim/territory.ts` owns it.
- NPC goal builders live in `src/sim/territory.ts`, not a new file — the quality gate limits file count in `src/sim/`.
- Save step 7 to 8 added: the saved-shape test failed because new stocks add part and goods variants to the sampled shape. The step drops the retired `fallen-sun` stock, its searched mark and any search of it. `npm run save:shape` ran after it.
- `siteUnder`, `NEUTRAL_SITES`, nav `nearSite`, `placeSpot` cheat and the terrain test list skip territories — each assumed pads or gates.
- `npm run perf` and `npm run playtest` were not run, as the stage instructions say.

### Results
- `npm test`: 2767 tests; the last full run had one failure (`terrain-file.test.ts` pinned the old prop kind list), now fixed and passing alone. `npm run typecheck` and `npm run quality` pass. `npm run stuck`: clean, 0 stalls.
- Econ (`npm run econ`, 1 seed, 5 days), tier 1 wage per turn, before to after: salvageOnly 0.80 to 1.19, haulOnly 0.57 to -0.36, contractsOnly -0.90 to -0.11. Tiers 2 and 3 read n/a, so no gap to the tier 2 wage exists to compare. Both outputs are in `tmp/issue-81/` (untracked).
- Browser check on software GL: debris and the reactor draw, the core glows, the driver loses health inside the zone. Screenshots are in `tmp/issue-81/`.

### Known risks
- Pre-existing failures fixed on their own commits: none found.
- Debris looks and spot counts (AS1, AS6) need the user's eye and the committee's tuning. Frame cost (UK2) is unmeasured.

### Testing stage
- Post-merge typecheck broke in `salvage.test.ts` (`canScavenge` now takes a stock id); fixed in its own commit.
- ureview fixed: `nearestPad` throws a clear error for a territory, `territoryGrounds` uses the rule with the largest outer ring, `spotGoal` guards an empty spot list.
- ureview not fixed (low risk, noted): the repeated `kind !== 'territory'` filters across five modules, and `territoryOfStock` parsing the baked id.
- Screenshot `.factory/screenshot.png` taken without GPU flags: debris, reactor glow, driver health 96 inside the zone.
