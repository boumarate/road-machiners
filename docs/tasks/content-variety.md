# Content variety

Status: done
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

- Baseline npm test: 242 passed, one pre-existing timeout in combat.test.ts, the 80-turn traffic invariant at its 10-second deadline. Full output: tmp/baseline-npm-test.log. The unchanged test passed in focused and final full-suite checks.
- PH1: six new catalog tests failed on missing content, then all 20 catalog/grid tests and npm run typecheck passed. Logs: tmp/content-red.log, tmp/content-green.log, tmp/content-typecheck.log.

- PH2: seeded variation test failed with only two raider combinations, then 89 generation/grid/activity/economy/salvage/combat tests passed with two test workers. This includes the baseline 80-turn traffic test, unchanged, in 7.2 seconds. Typecheck passed. Logs: tmp/npc-red.log, tmp/npc-contracts.log, tmp/npc-regressions.log, tmp/npc-typecheck.log.

- PH3: four terrain tests failed before implementation. All 15 terrain tests then passed, covering ten generated surface types, unchanged heights and road/site priority, and matching movement/preview results.
- Full-suite attacks caught a stale three-good expectation and a courier collision-step violation. The price test now follows GOOD_IDS. Courier speed is 7.5 and radius 0.5, so its maximum speed with any engine remains below the substep bound. The movement test derives the maximum engine bonus from all engine definitions. All 61 combat/movement/economy tests passed with one test worker and unchanged timeouts (tmp/regression-recheck.log).
- Browser checks bought all twenty new parts and all five new chassis, verified all five new goods in the market, bought electronics, dragged the purchased shotgun onto a working mount, rejected excess cargo without changing state, and rendered varied NPCs plus all ten terrain types. The earlier `+-1` engine label failure is fixed. No browser errors occurred (tmp/content-browser-final.log, tmp/content-browser-results.json). Across 40 seeds, sampling produced 65 raider, 40 trader and 37 scavenger loadouts. Screenshots inspected under .playtest/content/.
- The sequential 12-turn playtest had no reported gameplay errors but failed the frame-rate threshold at 19.5 FPS (tmp/release-playtest.log). Untouched baseline 8671df3 also completed 12 turns and failed at 12.5 FPS (/Users/boris/Documents/Korovan/.worktrees/content-baseline/tmp/playtest-verified.log). Both used the same lockfile, browser flags, viewport and seed. Server process working directories were verified: baseline port 5198 and content branch port 5187. An earlier comparison on occupied port 5188 was discarded. These observations do not establish a content performance regression. Renderer performance work is outside the variation scope.
- Initial browser playtest completed 12 turns with no reported gameplay errors but failed its 20 FPS threshold at 9.5 FPS (tmp/playtest.log). Host load was later observed at 46.62 with multiple unrelated test processes. Neither other sessions nor the threshold were changed. The later sequential comparison is recorded above.
- The next full suite passed 276 tests but timed out in two movement tests at their unchanged five-second deadlines, while browser checks and unrelated jobs were active (tmp/full-tests-final.log). Both tests had passed in the focused 61-test run. A subsequent full run without overlapping this task's browser check passed all 283 tests across 27 files in 74 seconds, with unchanged timeouts (tmp/release-tests.log).
- Five real-physics chassis checks, typecheck and production build passed (tmp/chassis-physics.log, tmp/typecheck-final.log, tmp/build-final.log). Build reports the existing large-bundle warning.

### Attack results

- CK1 (IV1, IV5) — Catalog additions cannot be purchased, mounted or driven: held by catalog tests, five physical chassis checks and browser purchase/drag scenarios.
- CK2 (IV3, IV4) — Weighted rolls allow malformed inputs, impossible mounts, overspending, excess mass or partial state mutation: held by 25 loadout tests, including invalid inputs and actual vehicle construction.
- CK3 (IV2, IV5) — Terrain changes heights, roads or places, or disagrees with movement previews: held by terrain and routing tests. Region data is unchanged.
- CK4 (IV6) — Random loadouts alter NPC caps or salvage rules: held by periodic spawn, NPC activity/economy and salvage tests. Salvage source is unchanged.
- CK5 — Runtime content causes browser crashes or misses the frame-rate gate: interactions and twelve turns held, but frame-rate gate failed on both branch and untouched baseline. Performance remains an explicitly reported baseline issue, without changing the threshold or renderer.

## Code smells

- package-lock.json — Baseline npm ci reported two moderate vulnerability findings. The lockfile is unchanged, and dependency remediation is outside this content task. Details were not audited. Evidence: ../content-baseline/tmp/npm-ci.log.

## Conclusion

Outcome: The content variation goal is demonstrated on source commit 7026155 through 283 passing tests, typecheck, build and real browser purchases, mounting, spawning and rendering. The frame-rate gate remains failed on both branch and untouched baseline.

- Two fresh parallel reviews found no code issues: workflow 4d92f4fd-5b40-443d-9c41-32e7326cf88f, outputs review/npc-sampling.md and review/content-integration.md under the managed session artifacts. Parent verified Git state separately.
- Browser evidence counts five listed goods but purchases electronics only. The catalog test buys and sells all five new goods. The reviewer wording that all five were bought in the browser is broader than the script evidence.
- No skills, places, salvage rules, road network or elevation rules changed. Existing NPC caps and classes remain. Main is unmerged, and both test servers were stopped.
- Remaining user choice: merge or open a pull request, or retain the branch. Worktrees content-variety and content-baseline are preserved pending cleanup approval.

### Deviations from plan

- Use a four-wheel Longbed truck instead of the proposed six-wheel truck. src/phys/body.ts defines four physical wheel mounts and current chassis tests require four core wheels. This preserves the requested fifth chassis variety without adding a wheel/physics system.
- Added physical body dimensions in src/data/physics.ts for distinct new chassis silhouettes, consumed by the existing bodyOf and render paths. src/phys/content.test.ts adds real driving and upright/reproducible physics checks for all five frames.
- Updated src/sim/movement.test.ts, src/sim/economy.test.ts and src/ui/town.ts after verification exposed assumptions that the new content made invalid.
- The single-worker workflow was stopped at the user's request. Only dependency setup and baseline tests had run. The parent completed implementation. Two independent reviewers ran in parallel afterward.
