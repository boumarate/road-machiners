# Content variety

Status: executing
Branch: content-variety
Worktree: /Users/boris/Documents/Korovan/.worktrees/content-variety
Goal: Players can buy and use five additional weapons, engines, armor parts, cargo parts, goods, and chassis, drive over five additional terrain varieties on Icarus, and encounter NPCs with varied equipment sampled from weighted tables.
Mode: interactive

## Context

- The user approved five new varieties per existing content category, excluded skills and places, and then replaced the fixed NPC loadout proposal with random sampling from equipment tables. Salvaging is explicitly out of scope.
- The user requested execution without further work-order questions. Implementation proceeds from the accepted scope with conservative content choices.
- Catalogs live in src/data. Town shops enumerate parts and goods, while chassis availability has an explicit list. Vehicle construction rejects parts that do not fit.
- Main has concurrent uncommitted work in terrain, rendering, and simulation. This task starts from main commit 8671df34240958f4b4744cd26199561d2308fc9b in an isolated worktree. Do not merge or copy the concurrent edits.

## Design

Add grounded machinery with tradeoffs in cost, weight, space, protection, firepower, speed, and fuel use. Preserve existing catalog entries and start kits. Use current gameplay systems rather than introduce articulated trailers, new damage systems, factions, skills, weather, places, or personal items.

- Weapons: shotgun turret, autocannon, tank gun, rocket rack, sniper cannon. Express behavior with current range, spread, rounds, penetration, splash, firing arc, and reload fields.
- Engines: light flat-four, workhorse diesel, racing V6, heavy diesel, turbine.
- Armor: scrap panels, ceramic plates, spaced armor, reinforced cage, plow ram.
- Cargo parts: panniers, flatbed extension, light cargo frame, enclosed cargo frame, heavy cargo frame. These are mounted grid extensions, not independently simulated trailers.
- Goods: grain, textiles, machine tools, batteries, electronics. Each has a mass and prices in both existing towns with useful trade opportunities.
- Chassis: courier, utility van, six-wheel truck, armored carrier, heavy tractor. Give each a valid distinct grid and handling/capacity tradeoff. Derive physical wheels from core wheel placements and verify supported wheel counts before choosing layouts.
- Terrain: mud, gravel, salt crust, cracked asphalt, ash. Give each a distinct palette color and driving factor. Generate patches on the existing map without changing its roads, places, or heights.
- NPCs: retain existing classes, templates, behavior, spawn cadence, and population caps. Replace fixed chassis/parts/cargo at spawn with role-specific weighted pools. Generate at least five distinct valid outcomes per class across a deterministic seed sample, rather than add fifteen new spawn populations. Common equipment has higher weight, rare equipment lower weight. Use equipment budgets separate from wallets. Sample chassis first, fit required engine and weapon before optional armor/cargo, and reserve physical cargo room. Candidate filtering handles fit and budget before rolling, without retry-until-success loops or silently discarding required items. Explicit optional-empty outcomes are allowed. Invalid tables or impossible required choices fail loudly.

TDD: yes for deterministic catalog, generation, spawn, and terrain behavior. Browser checks and screenshots verify visual integration.

### Invariants

- IV1 — Add exactly five entries to each of the seven approved catalog categories. Preserve old IDs and existing content.
- IV2 — No changes to salvage/wreck stock rules, skills, places, map size, road network, terrain heights, core component variants, or NPC class behavior.
- IV3 — All generated equipment fits, required components are mounted, goods fit, and configured equipment budgets are respected. Each table reference and weight is valid.
- IV4 — NPC sampling goes through src/sim/rng.ts and is reproducible from world state. Terrain patches use the existing seed-derived noise without consuming world RNG. No render or physics imports enter src/sim.
- IV5 — All new goods/parts/chassis are usable through existing shops and inventory. New terrain occurs on Icarus and uses the same driving factor in previews and turns.
- IV6 — Existing NPC population limits and wallet/upkeep behavior remain intact. Loot remains the existing inventory-derived behavior with no death-time roll.

## Plan

Approach: extend the catalog owners, add one focused NPC generation component, and use existing shops, grid placement, RNG, and render paths. Implement serially in one isolated worktree because generation depends on the finished catalog. No general content framework.

### PH1 — Expand equipment and vehicle catalogs

- src/data/parts.ts:52-107 owns part definitions. Add twenty entries with valid existing kinds and mechanical tradeoffs (IV1, IV5).
- src/data/goods.ts:5-16 owns goods and town prices. Add five goods to the registry, ID list, and both town price lists (IV1, IV5).
- src/data/chassis.ts:33-179 owns chassis definitions and player availability. Add five grids, fixed core placements, physics-compatible wheel layouts, and purchase entries (IV1, IV5).
- src/data/content.test.ts (new) owns catalog and construction examples. Verify additions, valid references, prices, chassis construction, and new part fit on at least one available chassis. Add economy integration cases beside src/sim/economy.test.ts where needed.
- src/three/render/vehicle.ts:35-40 owns 3D chassis shape selection. Extend render descriptors only where new silhouettes require them. Keep render-only tuning beside its data owner and do not change combat/physics rules. Inspect src/phys/body.ts and the existing 2D render consumer before adding any look discriminant.
- Commit: Add equipment goods and chassis variety.

### PH2 — Generate varied NPC equipment

- src/data/npcs.ts:13-51 owns templates and role-specific weighted equipment tables. Introduce explicit loadout budgets, pool weights, required/optional slots, and cargo quantities. Do not increase spawn populations (IV2, IV3, IV6).
- src/sim/npc-loadout.ts (new) owns seeded equipment selection, eligibility by fitting and budget, and validation of impossible required choices. Public operation: generateNpcLoadout(world: World, template: NpcTemplate): { chassisId: string; parts: string[]; cargo: Record<string, number> }. Keep pool types with their data owner. Reuse the existing grid/mount logic rather than duplicate geometry.
- src/sim/spawn.ts:30-55 consumes the generated chassis before checking spawn radius, then constructs the actual vehicle with the sampled parts and cargo. Use the same path for initial and periodic spawns (IV3, IV4, IV6).
- src/sim/npc-loadout.test.ts (new) and focused spawn tests own reproducibility, different outcomes, rare/common sampling boundaries, fit, mass/capacity checks supported by existing rules, budget checks, malformed tables, required-slot failure, and real spawn integration. Update existing template consumers/tests to the new contract without compatibility shims.
- Commit: Generate NPC equipment from weighted tables.

### PH3 — Add terrain variety and verify play

- src/data/terrain.ts:6-20,71-78 owns five new terrain definitions and patch selection parameters (IV1, IV2, IV5).
- src/sim/terrain.ts:30-39 owns tile selection. Add seeded patch selection while retaining road, site, and steep-ground precedence, unchanged elevations, and routable map approaches.
- src/sim/terrain.test.ts owns repeatability, presence of new types, unchanged heights and roads/sites, and driving factors. src/render/groundPaint.ts already reads terrain colors, change it only if required to make new terrain visibly usable.
- Verify with npm test, npm run typecheck, npm run build, and npm run playtest against a worktree-local dev server. Keep logs and a focused Playwright scenario in tmp/. Show new market/garage/chassis content, exercise a purchase/equip path, capture varied NPCs and terrain, and inspect screenshots. Do not claim pixel-level visual approval.
- Scan non-task docs for obsolete catalog claims and update only material content changes after verification. Run fresh read-only independent review before marking done.
- Commit: Add terrain variety and verify content integration.

### Risks and verification

- RK1 — Main has concurrent edits in shared source files. Keep all work isolated and leave integration to the user. Branch checks do not validate the unrelated dirty main checkout.
- RK2 — Expanded weighted pools can create impossible chassis/part combinations. Test actual placements and complete generated vehicles across seeded samples and force boundary selections, rather than only checking table counts.
- RK3 — Cargo expansion must not pretend to provide articulated trailer physics. Use mounted frame names and the existing extra-row mechanic.
- RK4 — Reusing visual primitives can reduce distinction. Use deliberate proportions/layouts and capture screenshots. No unrelated art-system rewrite.

## Verify

- Baseline npm test: 242 passed, one pre-existing timeout in combat.test.ts, the 80-turn traffic invariant at its 10-second deadline. Full output: tmp/baseline-npm-test.log. Recheck this test separately during final verification without changing its assertion or timeout.
- PH1: six new catalog tests failed on missing content, then all 20 catalog/grid tests and npm run typecheck passed. Logs: tmp/content-red.log, tmp/content-green.log, tmp/content-typecheck.log.

- PH2: seeded variation test failed with only two raider combinations, then 89 generation/grid/activity/economy/salvage/combat tests passed with two test workers. This includes the baseline 80-turn traffic test, unchanged, in 7.2 seconds. Typecheck passed. Logs: tmp/npc-red.log, tmp/npc-contracts.log, tmp/npc-regressions.log, tmp/npc-typecheck.log.

## Conclusion

### Deviations from plan

- Use a four-wheel Longbed truck instead of the proposed six-wheel truck. src/phys/body.ts defines four physical wheel mounts and current chassis tests require four core wheels. This preserves the requested fifth chassis variety without adding a wheel/physics system.
- Added physical body dimensions in src/data/physics.ts for distinct new chassis silhouettes, consumed by the existing bodyOf and render paths.
- The single-worker workflow was stopped at the user's request. Only dependency setup and baseline tests had run. The parent owns implementation. Independent review can run in parallel with final checks.
